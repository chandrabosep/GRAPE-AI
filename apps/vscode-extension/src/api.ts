import { createSSEParser, type ChatStreamEvent } from '@aam/shared';
import type { AuthManager } from './auth';

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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AccountSummary {
  creditBalanceMicro: string;
  withdrawableMicro: string;
  todayTokens: number;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly auth: AuthManager,
  ) {}

  async me(): Promise<AccountSummary | null> {
    const response = await this.request('/api/v1/me', { method: 'GET' });
    if (!response?.ok) return null;

    const body = (await response.json()) as {
      credits: { balanceMicro: string; withdrawableMicro: string };
      usageToday: { todayTokens: number };
    };

    return {
      creditBalanceMicro: body.credits.balanceMicro,
      withdrawableMicro: body.credits.withdrawableMicro,
      todayTokens: body.usageToday.todayTokens,
    };
  }

  /**
   * Streams a chat response.
   *
   * Yields typed events rather than raw text so the caller can react to the
   * sponsored card and the reward as first-class things, not by parsing prose.
   */
  async *chat(
    messages: ChatMessage[],
    context: EditorContext | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const response = await this.request('/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, context, useCredits: true }),
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

  async acknowledgeAd(impressionId: string, visibleMs: number): Promise<void> {
    await this.request(`/api/v1/ads/impressions/${impressionId}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibleMs }),
    });
  }

  async clickAd(impressionId: string): Promise<void> {
    await this.request(`/api/v1/ads/impressions/${impressionId}/click`, { method: 'POST' });
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
