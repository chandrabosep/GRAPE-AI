import type { SponsoredAd } from '@aam/shared';

/** Typed message contract between the extension host and the webview. */

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'send'; id: string; text: string }
  | { type: 'cancel' }
  | { type: 'adVisible'; impressionId: string; visibleMs: number }
  | { type: 'adClick'; impressionId: string; url: string }
  | { type: 'adDismiss'; impressionId: string }
  | { type: 'insertCode'; code: string }
  | { type: 'signIn' }
  | { type: 'openDashboard' };

export interface HostState {
  signedIn: boolean;
  creditBalanceMicro: string | null;
  hasSelection: boolean;
  includeSelection: boolean;
}

export type HostToWebview =
  | { type: 'state'; state: HostState }
  | { type: 'delta'; id: string; text: string }
  | { type: 'ad'; id: string; ad: SponsoredAd }
  | { type: 'reward'; id: string; amountMicro: number; balanceMicro: number }
  | { type: 'usage'; id: string; totalTokens: number; costMicro: number }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; message: string };
