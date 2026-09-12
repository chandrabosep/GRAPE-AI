import { createSSEParser, type ChatStreamEvent, type ContentBlock } from '@aam/shared';
import type { AuthManager } from './auth';
import type { ModelChoice } from './protocol';

/**
 * Thin API client.
 *
 * Handles one thing carefully: a 401 mid-session means the short-lived access
 * token expired, which is normal. The request is retried once after refreshing
 * so the user is not thrown back to a sign-in prompt in the middle of typing.
 */

export interface EditorContext {
  languageId?: string;
  fileName?: string;
  workspaceName?: string;
  selection?: string;
}

/**
 * One message in the conversation.
 *
 * Mirrors the server contract rather than defining its own: a tool-using turn
 * carries structured blocks, and flattening them here would lose the link
 * between a call and the result that answers it.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** What the server decided about one confirmed impression. */
export interface AdOutcome {
  granted: boolean;
  amountMicro: string;
  balanceMicro: string | null;
}

export interface AccountSummary {
  creditBalanceMicro: string;
  withdrawableMicro: string;
  todayTokens: number;
  /** Null when the deployment does not expose an email for the account. */
  email: string | null;
  displayName: string | null;
  todayCostMicro: string;
  requestsToday: number;
}

/**
 * The deployment's public numbers.
 *
 * Only the payout threshold is used so far, and it is what turns earnings into
 * a bar with a real end rather than a number that just grows. Fetched rather
 * than hardcoded for the same reason the model catalog is: a client-side copy
 * of a server-side rule goes stale silently.
 */
export interface PublicConfig {
  minPayoutMicro: number;
}

export class ApiClient {
  private publicConfig: PublicConfig | undefined;

  constructor(
    private readonly baseUrl: () => string,
    private readonly auth: AuthManager,
  ) {}

  async me(): Promise<AccountSummary | null> {
    const response = await this.request('/api/v1/me', { method: 'GET' });
    if (!response?.ok) return null;

    const body = (await response.json()) as {
      user?: { email?: string | null; displayName?: string | null };
      credits: { balanceMicro: string; withdrawableMicro: string };
      usageToday: { todayTokens: number; todayCostMicro?: string; requestCount?: number };
    };

    return {
      creditBalanceMicro: body.credits.balanceMicro,
      withdrawableMicro: body.credits.withdrawableMicro,
      todayTokens: body.usageToday.todayTokens,
      email: body.user?.email ?? null,
      displayName: body.user?.displayName ?? null,
      todayCostMicro: body.usageToday.todayCostMicro ?? '0',
      requestsToday: body.usageToday.requestCount ?? 0,
    };
  }

  /**
   * Public configuration, fetched once per window.
   *
   * Unauthenticated and effectively constant for the life of a deployment, so
   * there is nothing to gain from asking again.
   */
  async config(): Promise<PublicConfig | null> {
    if (this.publicConfig !== undefined) return this.publicConfig;

    const response = await this.request('/api/v1/config/public', { method: 'GET' });
    if (!response?.ok) return null;

    const body = (await response.json()) as { credits?: { minPayoutMicro?: number } };
    const minPayoutMicro = body.credits?.minPayoutMicro;
    // Cache only a real answer, so a transient failure does not pin the panel
    // to a missing threshold for the rest of the session.
    if (typeof minPayoutMicro !== 'number') return null;

    this.publicConfig = { minPayoutMicro };
    return this.publicConfig;
  }

  /**
   * The models this deployment offers.
   *
   * Fetched rather than hardcoded, so the picker can never list something the
   * server would reject, and prices shown next to a model are the ones that
   * will actually be charged.
   */
  async models(): Promise<ModelChoice[]> {
    const response = await this.request('/api/v1/ai/models', { method: 'GET' });
    if (!response?.ok) return [];

    const body = (await response.json().catch(() => null)) as { models?: ModelChoice[] } | null;
    return body?.models ?? [];
  }

  /**
   * Streams a chat response.
   *
   * Yields typed events rather than raw text so the caller can react to the
   * sponsored cards and the reward as first-class things, not by parsing prose.
   */
  async *chat(
    messages: ChatMessage[],
    context: EditorContext | undefined,
    options: { model: string | null; sessionId: string | null; tools: boolean },
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const response = await this.request('/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages,
        context,
        useCredits: true,
        // Tools are offered only because *this* client can run them. The server
        // never executes one, so a caller that cannot either must not ask.
        tools: options.tools,
        // Both are hints the server is free to override: it narrows the model to
        // its own catalog, and treats the session id as a grouping key only.
        ...(options.model ? { model: options.model } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      }),
      signal,
    });

    if (!response) {
      yield { type: 'error', code: 'unauthorized', message: 'Sign in to use the assistant.' };
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      yield {
        type: 'error',
        code: body?.error?.code ?? 'internal_error',
        message: body?.error?.message ?? 'The request failed.',
      };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const parser = createSSEParser();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          yield event;
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  /**
   * Confirms the card was on screen. The response carries the reward decision,
   * which is the only trustworthy source for it: the client never computes what
   * it is owed, it is told.
   */
  async acknowledgeAd(impressionId: string, visibleMs: number): Promise<AdOutcome | null> {
    const response = await this.request(`/api/v1/ads/impressions/${impressionId}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibleMs }),
    });
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as AdOutcome | null;
  }

  async clickAd(impressionId: string): Promise<AdOutcome | null> {
    const response = await this.request(`/api/v1/ads/impressions/${impressionId}/click`, {
      method: 'POST',
    });
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as AdOutcome | null;
  }

  async dismissAd(impressionId: string): Promise<void> {
    await this.request(`/api/v1/ads/impressions/${impressionId}/dismiss`, { method: 'POST' });
  }

  private async request(path: string, init: RequestInit, retry = true): Promise<Response | null> {
    const token = await this.auth.accessToken();
    if (!token) return null;

    const response = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });

    // An expired 15-minute token is routine, not a sign-in failure.
    if (response.status === 401 && retry) {
      if (await this.auth.refresh()) {
        return this.request(path, init, false);
      }
      return null;
    }

    return response;
  }
}
