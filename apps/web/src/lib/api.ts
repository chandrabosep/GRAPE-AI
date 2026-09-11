'use client';

/**
 * Browser API client.
 *
 * Tokens live in localStorage rather than a cookie, so they are never attached
 * to a cross-site request automatically, and — unlike sessionStorage — they
 * survive closing the browser. The refresh token is good for 30 days, so being
 * signed out by quitting the browser was a storage choice, not a security one.
 * On a 401 it refreshes once and retries, since access tokens are deliberately
 * short-lived.
 */

const ACCESS_KEY = 'aam.accessToken';
const REFRESH_KEY = 'aam.refreshToken';

/** Storage can throw in private windows or with site data blocked. */
function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return read(ACCESS_KEY);
}

export function storeSession(session: { accessToken: string; refreshToken: string }): void {
  try {
    window.localStorage.setItem(ACCESS_KEY, session.accessToken);
    window.localStorage.setItem(REFRESH_KEY, session.refreshToken);
  } catch {
    // Nothing persists; the tab keeps working until it is closed.
  }
}

export function clearSession(): void {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      store.removeItem(ACCESS_KEY);
      store.removeItem(REFRESH_KEY);
    }
  } catch {
    // Already unavailable: there is nothing to clear.
  }
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
  const refreshToken = read(REFRESH_KEY);
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
