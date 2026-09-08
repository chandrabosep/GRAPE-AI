import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ProviderError,
  type AIProvider,
  type ClassifyRequest,
  type ModelInfo,
  type ProviderChatEvent,
  type ProviderChatRequest,
  type ProviderChatResult,
  type TokenUsage,
} from './types.js';

/**
 * AWS Bedrock via the Converse API.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. Claude 5 models have no in-Region model id on Bedrock. The `us.` or
 *    `global.` cross-region inference profile id is required, so the model ids
 *    passed in from config must carry that prefix.
 * 2. Token usage arrives in the final `metadata` event of the stream, not per
 *    delta. We never bill from an estimate or from anything the client reports,
 *    so the usage event is the only number that reaches the ledger.
 */

export interface BedrockProviderOptions {
  region: string;
  chatModel: string;
  premiumModel: string;
  classifierModel: string;
  /** Injectable for tests. */
  client?: BedrockRuntimeClient;
}

function toBedrockMessages(messages: ProviderChatRequest['messages']): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: [{ text: m.content }] satisfies ContentBlock[],
  }));
}

function isThrottling(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  return name === 'ThrottlingException' || name === 'TooManyRequestsException';
}

export class BedrockProvider implements AIProvider {
  readonly id = 'bedrock';

  private readonly client: BedrockRuntimeClient;
  private readonly options: BedrockProviderOptions;

  constructor(options: BedrockProviderOptions) {
    this.options = options;
    // No explicit credentials: the SDK default chain resolves profile, SSO or
    // role. Credentials must never be handed to a client surface.
    this.client = options.client ?? new BedrockRuntimeClient({ region: options.region });
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: this.options.chatModel,
        label: 'Standard',
        tier: 'standard',
        supportsStreaming: true,
      },
      {
        id: this.options.premiumModel,
        label: 'Premium',
        tier: 'premium',
        supportsStreaming: true,
      },
      {
        id: this.options.classifierModel,
        label: 'Fast',
        tier: 'fast',
        supportsStreaming: true,
      },
    ];
  }

  async *stream(req: ProviderChatRequest): AsyncIterable<ProviderChatEvent> {
    const command = new ConverseStreamCommand({
      modelId: req.model,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      messages: toBedrockMessages(req.messages),
      inferenceConfig: {
        maxTokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
      },
    });

    let response;
    try {
      response = await this.client.send(command, { abortSignal: req.signal });
    } catch (error) {
      throw new ProviderError(
        isThrottling(error) ? 'Model is busy, retry shortly' : 'Bedrock request failed',
        { retryable: isThrottling(error), cause: error },
      );
    }

    if (!response.stream) {
      throw new ProviderError('Bedrock returned no stream');
    }

    try {
      for await (const event of response.stream) {
        const text = event.contentBlockDelta?.delta?.text;
        if (text) yield { type: 'delta', text };

        if (event.messageStop) {
          yield { type: 'stop', reason: event.messageStop.stopReason ?? null };
        }

        // Always last. This is the only token count we trust.
        const usage = event.metadata?.usage;
        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            },
          };
        }
      }
    } catch (error) {
      throw new ProviderError('Bedrock stream failed mid-response', {
        retryable: isThrottling(error),
        cause: error,
      });
    }
  }

  async complete(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const command = new ConverseCommand({
      modelId: req.model,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      messages: toBedrockMessages(req.messages),
      inferenceConfig: {
        maxTokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
      },
    });

    try {
      const response = await this.client.send(command, { abortSignal: req.signal });
      const text = (response.output?.message?.content ?? [])
        .map((block) => block.text ?? '')
        .join('');

      const usage: TokenUsage = {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
        totalTokens: response.usage?.totalTokens ?? 0,
      };

      return { text, usage, stopReason: response.stopReason ?? null };
    } catch (error) {
      throw new ProviderError(
        isThrottling(error) ? 'Model is busy, retry shortly' : 'Bedrock request failed',
        { retryable: isThrottling(error), cause: error },
      );
    }
  }

  /**
   * Structured output via a forced tool call.
   *
   * Native JSON-schema output is not supported across every Claude 5 model, but
   * a forced tool call is, so this is the portable option. `toolChoice` makes
   * the call mandatory, which removes the "model answered in prose" failure mode.
   */
  async classify<T>(req: ClassifyRequest<T>): Promise<T | null> {
    const tool: Tool = {
      toolSpec: {
        name: req.toolName,
        description: req.toolDescription,
        // The SDK types this as a recursive DocumentType union that a plain
        // JSON Schema object cannot satisfy structurally. One cast at the
        // boundary is honest; loosening our own interface would not be.
        inputSchema: { json: req.jsonSchema } as unknown as ToolInputSchema,
      },
    };

    const command = new ConverseCommand({
      modelId: req.model,
      system: [{ text: req.system }],
      messages: [{ role: 'user', content: [{ text: req.input }] }],
      inferenceConfig: { maxTokens: req.maxTokens ?? 300, temperature: 0 },
      toolConfig: {
        tools: [tool],
        toolChoice: { tool: { name: req.toolName } },
      },
    });

    try {
      const response = await this.client.send(command);
      const block = (response.output?.message?.content ?? []).find((c) => c.toolUse);
      if (!block?.toolUse?.input) return null;
      return req.parse(block.toolUse.input);
    } catch (error) {
      // Classification is best-effort by design: the caller falls back to the
      // rules classifier so a Bedrock hiccup never blocks an answer.
      throw new ProviderError('Bedrock classification failed', {
        retryable: isThrottling(error),
        cause: error,
      });
    }
  }
}
