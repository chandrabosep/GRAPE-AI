import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolInputSchema,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ProviderError,
  type AIProvider,
  type ClassifyRequest,
  type ModelInfo,
  type ProviderChatEvent,
  type ProviderChatRequest,
  type ProviderChatResult,
  type ProviderMessage,
  type TokenUsage,
} from './types';

/**
 * AWS Bedrock via the Converse API.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. Recent Claude models have no in-Region model id on Bedrock. The `us.` or
 *    `global.` cross-region inference profile id is required, so the model ids
 *    passed in from config must carry that prefix.
 * 2. Token usage arrives in the final `metadata` event of the stream, not per
 *    delta. We never bill from an estimate or from anything the client reports,
 *    so the usage event is the only number that reaches the ledger.
 * 3. A Bedrock API key authenticates with a bearer token, which is a different
 *    auth scheme from SigV4 rather than a different credential. Handing it to
 *    `token` is not enough — the scheme has to be preferred explicitly, or the
 *    SDK resolves SigV4 first and fails looking for credentials that do not
 *    exist.
 */

export interface BedrockProviderOptions {
  region: string;
  chatModel: string;
  premiumModel: string;
  classifierModel: string;
  /** Long-lived Bedrock API key. Falls back to the SDK credential chain when absent. */
  apiKey?: string | undefined;
  /** Injectable for tests. */
  client?: BedrockRuntimeClient;
}

function toBedrockContent(
  content: ProviderMessage['content'],
): ContentBlock[] {
  if (typeof content === 'string') return [{ text: content }];

  return content.map((block): ContentBlock => {
    if (block.type === 'text') return { text: block.text };

    if (block.type === 'tool_use') {
      return {
        toolUse: {
          toolUseId: block.toolUseId,
          name: block.name,
          // Converse types this as a recursive DocumentType that a plain JSON
          // value cannot satisfy structurally. One cast at the boundary is
          // honest; loosening our own interface would not be.
          input: block.input as ToolUseBlock['input'],
        },
      };
    }

    return {
      toolResult: {
        toolUseId: block.toolUseId,
        content: [{ text: block.content }],
        // A failed tool still returns a result. Dropping it would leave the
        // model with a call it never heard back about, and it retries forever.
        status: block.isError ? 'error' : 'success',
      },
    };
  });
}

function toBedrockMessages(messages: ProviderChatRequest['messages']): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: toBedrockContent(m.content),
  }));
}

function toBedrockTools(tools: ProviderChatRequest['tools']): Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.inputSchema } as unknown as ToolInputSchema,
    },
  }));
}

function isThrottling(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  return name === 'ThrottlingException' || name === 'TooManyRequestsException';
}

/**
 * Builds the runtime client for whichever credential the deployment actually has.
 *
 * With an API key this is bearer auth; without one the SDK default chain
 * resolves a profile, SSO session or instance role. Either way the credential
 * lives only in this process and is never handed to a client surface.
 */
function createClient(options: BedrockProviderOptions): BedrockRuntimeClient {
  if (!options.apiKey) {
    return new BedrockRuntimeClient({ region: options.region });
  }

  return new BedrockRuntimeClient({
    region: options.region,
    token: { token: options.apiKey },
    // Without this the SigV4 scheme is resolved first and the request fails
    // hunting for credentials that a key-only deployment does not have.
    authSchemePreference: ['httpBearerAuth'],
  });
}

/**
 * Parses a tool call's accumulated arguments.
 *
 * Never string-matched: models vary in how they escape JSON, so the only
 * reliable read is a real parse. Malformed JSON becomes an empty object rather
 * than an exception — the tool then fails its own validation and the model is
 * told why, which it can recover from, whereas a thrown error kills the answer.
 */
function parseToolInput(json: string): unknown {
  const trimmed = json.trim();
  if (trimmed === '') return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

export class BedrockProvider implements AIProvider {
  readonly id = 'bedrock';

  private readonly client: BedrockRuntimeClient;
  private readonly options: BedrockProviderOptions;

  constructor(options: BedrockProviderOptions) {
    this.options = options;
    this.client = options.client ?? createClient(options);
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: this.options.chatModel,
        label: 'Sonnet',
        description: 'Balanced. The right default for everyday coding questions.',
        tier: 'standard',
        supportsStreaming: true,
        default: true,
      },
      {
        id: this.options.premiumModel,
        label: 'Opus',
        description: 'Deepest reasoning, slowest and most expensive per token.',
        tier: 'premium',
        supportsStreaming: true,
        default: false,
      },
      {
        id: this.options.classifierModel,
        label: 'Haiku',
        description: 'Fastest and cheapest. Good for quick lookups and syntax.',
        tier: 'fast',
        supportsStreaming: true,
        default: false,
      },
    ];
  }

  async *stream(req: ProviderChatRequest): AsyncIterable<ProviderChatEvent> {
    const tools = toBedrockTools(req.tools);

    const command = new ConverseStreamCommand({
      modelId: req.model,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      messages: toBedrockMessages(req.messages),
      inferenceConfig: {
        maxTokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
      },
      // toolChoice is deliberately left at the default. Forcing a call would
      // make the model reach for a file even when the developer asked something
      // it can answer outright.
      ...(tools ? { toolConfig: { tools } } : {}),
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

    /**
     * Tool calls arrive in pieces.
     *
     * The name and id land on `contentBlockStart`, then the arguments stream in
     * as fragments of JSON across any number of deltas, and only
     * `contentBlockStop` says the JSON is complete. Parsing before then reliably
     * fails on a half-written object, so each block is accumulated by index and
     * emitted once, at its stop.
     */
    const pending = new Map<number, { toolUseId: string; name: string; json: string }>();

    try {
      for await (const event of response.stream) {
        const text = event.contentBlockDelta?.delta?.text;
        if (text) yield { type: 'delta', text };

        const start = event.contentBlockStart?.start?.toolUse;
        if (start?.toolUseId && start.name) {
          pending.set(event.contentBlockStart?.contentBlockIndex ?? 0, {
            toolUseId: start.toolUseId,
            name: start.name,
            json: '',
          });
        }

        const argumentDelta = event.contentBlockDelta?.delta?.toolUse?.input;
        if (argumentDelta !== undefined) {
          const block = pending.get(event.contentBlockDelta?.contentBlockIndex ?? 0);
          if (block) block.json += argumentDelta;
        }

        if (event.contentBlockStop) {
          const index = event.contentBlockStop.contentBlockIndex ?? 0;
          const block = pending.get(index);
          if (block) {
            pending.delete(index);
            yield {
              type: 'tool_use',
              toolUseId: block.toolUseId,
              name: block.name,
              // A tool called with no arguments streams no deltas at all, which
              // is an empty string rather than "{}".
              input: parseToolInput(block.json),
            };
          }
        }

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
