/**
 * Provider-agnostic AI surface.
 *
 * Bedrock is the only implementation today, but nothing above this interface
 * knows that. The AI gateway, the intent classifier and the x402 service all
 * talk to `AIProvider`, so swapping or adding a provider is a constructor
 * change rather than a rewrite.
 */

/**
 * One piece of a message.
 *
 * Plain chat is text-only, but a tool-using turn has to carry the call and its
 * result as first-class blocks tied together by id — flattening them to prose
 * loses the link the model needs to continue.
 */
export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string | ProviderContentBlock[];
}

/** A tool the model may call. Executed by the caller, never by the provider. */
export interface ProviderTool {
  name: string;
  description: string;
  /** JSON Schema. Must set additionalProperties: false. */
  inputSchema: Record<string, unknown>;
}

export interface ProviderChatRequest {
  model: string;
  system?: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Offered to the model; omitted entirely when the caller cannot run them. */
  tools?: ProviderTool[];
  /** Aborts the upstream call when the client disconnects mid-stream. */
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ProviderChatEvent =
  | { type: 'delta'; text: string }
  /** Emitted once per tool call, after its arguments have fully arrived. */
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'stop'; reason: string | null };

export interface ProviderChatResult {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
}

export interface ClassifyRequest<T> {
  model: string;
  system: string;
  input: string;
  /** Name of the forced tool call; also the label the model sees. */
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool input. Must set additionalProperties: false. */
  jsonSchema: Record<string, unknown>;
  /** Validates and narrows the model's raw output. Throw to reject. */
  parse: (value: unknown) => T;
  maxTokens?: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** One line shown under the name in the model picker. */
  description: string;
  /** Rough tier used by plan gating, not by billing. */
  tier: 'standard' | 'premium' | 'fast';
  supportsStreaming: boolean;
  /** The model offered when the client expresses no preference. */
  default: boolean;
}

export interface AIProvider {
  readonly id: string;
  listModels(): ModelInfo[];
  stream(req: ProviderChatRequest): AsyncIterable<ProviderChatEvent>;
  complete(req: ProviderChatRequest): Promise<ProviderChatResult>;
  /** Returns null when the model declines to produce a valid classification. */
  classify<T>(req: ClassifyRequest<T>): Promise<T | null>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
  }
}
