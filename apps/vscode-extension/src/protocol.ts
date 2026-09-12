import type { SponsoredAd } from '@aam/shared';

/** Typed message contract between the extension host and the webview. */

/**
 * One exchange, as it is written to disk.
 *
 * Kept deliberately close to what the UI renders so a restored conversation is
 * the same conversation, not a transcript of it. Both sponsored slots are stored
 * too: their impressions were already recorded server-side, so hiding them on
 * restore would misrepresent what the developer was shown.
 */
/**
 * One tool call, as the developer sees it.
 *
 * Shown so the assistant's work is visible rather than implied: a turn that
 * silently read four files and then asserted something about the code is
 * indistinguishable from one that guessed. The status is what makes a write
 * legible as *proposed* until it is approved.
 */
export interface ToolActivity {
  /** The model's tool-use id. Also how an approval finds its write. */
  id: string;
  name: string;
  /** What it acted on — a path, or a query. */
  summary: string;
  status: 'running' | 'done' | 'error' | 'awaiting-approval' | 'applied' | 'rejected';
  /** An error message, a diff stat like "+12 −3", or a latency. */
  detail?: string;
  /**
   * The GraphQL a subgraph call ran, revealed when the row is expanded.
   *
   * Only server tools carry this. A file read names its file and that is the
   * whole of what it did; a Graph query's target says almost nothing without
   * the query itself, which is the part that shows the number in the answer
   * was fetched rather than guessed.
   */
  query?: string;
}

export interface PersistedTurn {
  id: string;
  question: string;
  answer: string;
  /** Tool calls made while answering, in order. */
  tools: ToolActivity[];
  /** The card below the answer. */
  ad: SponsoredAd | null;
  /** The single line shown beside the answer while it streamed. */
  inlineAd: SponsoredAd | null;
  rewardMicro: number | null;
  usage: { totalTokens: number; costMicro: number } | null;
  /** Which model answered. Shown per turn, because it can change mid-session. */
  model: string | null;
}

/**
 * One conversation.
 *
 * Sessions live here, in extension storage, and never reach the server. The
 * data model forbids any table that could hold a prompt or a reply, so keeping
 * conversations on the developer's own machine is what makes that promise true
 * rather than merely stated. The server still sees a `sessionId`, which scopes
 * usage and ad frequency without ever being attached to text.
 */
export interface ChatSession {
  id: string;
  /** Derived from the first question. Editable. */
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: PersistedTurn[];
}

/** A session in the switcher, without the weight of its transcript. */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  turnCount: number;
}

export interface ModelChoice {
  id: string;
  label: string;
  description: string;
  tier: 'standard' | 'premium' | 'fast';
  default: boolean;
  inputMicroPerToken: number;
  outputMicroPerToken: number;
}

export type WebviewToHost =
  | { type: 'ready' }
  /** `replaceLast` is a regenerate: the previous exchange is dropped first. */
  | { type: 'send'; id: string; text: string; replaceLast?: boolean }
  | { type: 'cancel' }
  /** The turn id travels with ad events so a reward lands on the right turn. */
  | { type: 'adVisible'; id: string; impressionId: string; visibleMs: number }
  | { type: 'adClick'; id: string; impressionId: string; url: string }
  | { type: 'adDismiss'; impressionId: string }
  | { type: 'copy'; text: string }
  | { type: 'persist'; turns: PersistedTurn[] }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'selectModel'; modelId: string }
  /** Saves a proposed write and lets the assistant continue. */
  | { type: 'approveWrite'; toolUseId: string }
  /** Refuses it. The assistant is told, so it can adapt rather than retry. */
  | { type: 'rejectWrite'; toolUseId: string }
  /** Opens the proposed change in the editor's own diff view. */
  | { type: 'reviewWrite'; toolUseId: string }
  | { type: 'insertCode'; code: string }
  | { type: 'signIn' }
  | { type: 'openDashboard' };

export interface HostState {
  signedIn: boolean;
  creditBalanceMicro: string | null;
  hasSelection: boolean;
  includeSelection: boolean;
  models: ModelChoice[];
  selectedModel: string | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
}

/**
 * What the account panel renders.
 *
 * `null` for a figure means "not known yet", which is not the same as zero and
 * must not render as `$0.00` — a balance that blinks to nothing while a request
 * is in flight reads as money lost. `offline` says the last fetch failed, so
 * the panel can keep showing the previous figures and mark them as stale rather
 * than replacing them with zeros.
 */
export interface AccountState {
  signedIn: boolean;
  offline: boolean;
  email: string | null;
  /** Shown when there is no email — a wallet-only account still has a name. */
  displayName: string | null;
  creditBalanceMicro: string | null;
  withdrawableMicro: string | null;
  /** The withdrawal threshold, which is what makes the earnings bar meaningful. */
  minPayoutMicro: number | null;
  todayTokens: number | null;
  todayCostMicro: string | null;
  requestsToday: number | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
}

export type AccountWebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'signIn' }
  | { type: 'openDashboard' }
  | { type: 'topUp' }
  | { type: 'withdraw' };

export type AccountHostToWebview = { type: 'account'; state: AccountState };

export type HostToWebview =
  | { type: 'state'; state: HostState }
  /** A whole conversation, on start-up or after switching sessions. */
  | { type: 'restore'; sessionId: string; turns: PersistedTurn[] }
  | { type: 'delta'; id: string; text: string }
  | { type: 'ad'; id: string; ad: SponsoredAd }
  /** A tool call started, finished, or is waiting on the developer. */
  | { type: 'tool'; id: string; activity: ToolActivity }
  | { type: 'reward'; id: string; amountMicro: number; balanceMicro: number }
  | { type: 'usage'; id: string; totalTokens: number; costMicro: number; model: string }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; message: string }
  | { type: 'notice'; text: string };
