'use client';

/**
 * Browser API client.
 *
 * The access token lives in memory plus sessionStorage rather than a cookie, so
 * a page refresh keeps you signed in without exposing the token to any
 * cross-site request. On a 401 it refreshes once and retries, which matters
 * because access tokens are deliberately short-lived.
 */

const ACCESS_KEY = 'aam.accessToken';
const REFRESH_KEY = 'aam.refreshToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(ACCESS_KEY);
}

export function storeSession(session: { accessToken: string; refreshToken: string }): void {
  window.sessionStorage.setItem(ACCESS_KEY, session.accessToken);
  window.sessionStorage.setItem(REFRESH_KEY, session.refreshToken);
}

export function clearSession(): void {
  window.sessionStorage.removeItem(ACCESS_KEY);
  window.sessionStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function refresh(): Promise<boolean> {
  const refreshToken = window.sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  storeSession(await response.json());
  return true;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && (await refresh())) {
    return api<T>(path, init, false);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      body?.error?.code ?? 'internal_error',
      body?.error?.message ?? 'Request failed',
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

/** Money is micro-USD end to end; format only at the edge. */
export function formatCredits(micro: string | number | null | undefined, digits = 4): string {
  if (micro === null || micro === undefined) return '—';
  return `$${(Number(micro) / 1_000_000).toFixed(digits)}`;
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(value);
}
