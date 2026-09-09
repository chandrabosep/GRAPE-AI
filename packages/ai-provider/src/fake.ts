import {
  type AIProvider,
  type ClassifyRequest,
  type ModelInfo,
  type ProviderChatEvent,
  type ProviderChatRequest,
  type ProviderChatResult,
  type TokenUsage,
} from './types';

/**
 * Deterministic provider for tests and offline UI work.
 *
 * Exists so the whole request lifecycle — usage reservation, intent, ad
 * selection, reward, ledger — can be integration-tested without AWS
 * credentials, network, or spend. It is never wired up in production; the
 * provider factory selects it only when explicitly configured.
 */

export interface FakeProviderOptions {
  /** Text the model "generates". Split into chunks to simulate streaming. */
  reply?: string;
  chunkSize?: number;
  /** Delay between chunks, ms. Zero in tests, non-zero for UI work. */
  delayMs?: number;
  /** Value returned by classify(), before parsing. */
  classification?: unknown;
  failWith?: Error;
}

const DEFAULT_REPLY =
  'To deploy a Solidity contract with Foundry, build it with `forge build`, then run ' +
  '`forge create` against your RPC endpoint with a funded deployer key. For anything ' +
  'beyond a throwaway testnet deploy, use a script with `forge script --broadcast` so ' +
  'the deployment is reproducible and reviewable.';

/** Stable, deterministic token estimate so test assertions do not drift. */
function estimateUsage(promptChars: number, replyChars: number): TokenUsage {
  const inputTokens = Math.ceil(promptChars / 4);
  const outputTokens = Math.ceil(replyChars / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

export class FakeProvider implements AIProvider {
  readonly id = 'fake';

  private readonly options: Required<Omit<FakeProviderOptions, 'failWith' | 'classification'>> &
    Pick<FakeProviderOptions, 'failWith' | 'classification'>;

  /** Every request seen, for assertions in tests. */
  readonly calls: ProviderChatRequest[] = [];

  constructor(options: FakeProviderOptions = {}) {
    this.options = {
      reply: options.reply ?? DEFAULT_REPLY,
      chunkSize: options.chunkSize ?? 24,
      delayMs: options.delayMs ?? 0,
      failWith: options.failWith,
      classification: options.classification,
    };
  }

  listModels(): ModelInfo[] {
    return [
      { id: 'fake-standard', label: 'Fake Standard', tier: 'standard', supportsStreaming: true },
      { id: 'fake-fast', label: 'Fake Fast', tier: 'fast', supportsStreaming: true },
    ];
  }

  async *stream(req: ProviderChatRequest): AsyncIterable<ProviderChatEvent> {
    this.calls.push(req);
    if (this.options.failWith) throw this.options.failWith;

    const { reply, chunkSize, delayMs } = this.options;
    for (let i = 0; i < reply.length; i += chunkSize) {
      if (req.signal?.aborted) return;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { type: 'delta', text: reply.slice(i, i + chunkSize) };
    }

    yield { type: 'stop', reason: 'end_turn' };
    yield {
      type: 'usage',
      usage: estimateUsage(this.promptChars(req), reply.length),
    };
  }

  async complete(req: ProviderChatRequest): Promise<ProviderChatResult> {
    this.calls.push(req);
    if (this.options.failWith) throw this.options.failWith;

    return {
      text: this.options.reply,
      usage: estimateUsage(this.promptChars(req), this.options.reply.length),
      stopReason: 'end_turn',
    };
  }

  async classify<T>(req: ClassifyRequest<T>): Promise<T | null> {
    if (this.options.failWith) throw this.options.failWith;
    if (this.options.classification === undefined) return null;
    return req.parse(this.options.classification);
  }

  private promptChars(req: ProviderChatRequest): number {
    return (
      (req.system?.length ?? 0) + req.messages.reduce((sum, m) => sum + m.content.length, 0)
    );
  }
}
