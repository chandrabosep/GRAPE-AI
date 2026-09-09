import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

/**
 * Browser-to-editor sign-in.
 *
 * The extension never handles a Privy credential or a wallet key. It opens the
 * web app with a random `state`, the signed-in browser mints a single-use code,
 * and that code is exchanged here for our own session. Nothing sensitive ever
 * travels in the callback URL, which would otherwise end up in shell history and
 * logs.
 *
 * Tokens live in SecretStorage, which VS Code encrypts with the OS keychain.
 */

const ACCESS_KEY = 'aiMarketplace.accessToken';
const REFRESH_KEY = 'aiMarketplace.refreshToken';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingLogin {
  state: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AuthManager {
  private pending: PendingLogin | null = null;

  private readonly onDidChangeEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly apiUrl: () => string,
  ) {}

  async isSignedIn(): Promise<boolean> {
    return (await this.context.secrets.get(ACCESS_KEY)) !== undefined;
  }

  async accessToken(): Promise<string | undefined> {
    return this.context.secrets.get(ACCESS_KEY);
  }

  /** Opens the browser and waits for the editor callback. */
  async signIn(): Promise<void> {
    const state = randomUUID();

    // Must not be cached: VS Code appends a window id so the callback reaches
    // the right window, and it differs between local, remote and web hosts.
    const callbackUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(`${vscode.env.uriScheme}://aam.ai-attention-marketplace/callback`),
    );

    const loginUrl = vscode.Uri.parse(
      `${this.apiUrl()}/auth/vscode?state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(callbackUri.toString(true))}`,
    );

    const codePromise = new Promise<string>((resolve, reject) => {
      this.pending?.reject(new Error('Superseded by a newer sign-in attempt'));
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Sign-in timed out. Try again, or paste the code manually.'));
      }, CALLBACK_TIMEOUT_MS);
      this.pending = { state, resolve, reject, timer };
    });

    await vscode.env.openExternal(loginUrl);

    const code = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Waiting for sign-in...' },
      () => codePromise,
    );

    await this.exchange(code, state);
  }

  /** Fallback for browsers or hosts that will not redirect to a custom scheme. */
  async signInWithPastedCode(): Promise<void> {
    const state = this.pending?.state;
    if (!state) {
      throw new Error('Start sign-in first, then paste the code shown in the browser.');
    }

    const code = await vscode.window.showInputBox({
      title: 'Paste your sign-in code',
      prompt: 'Copy the code shown in the browser after signing in.',
      ignoreFocusOut: true,
    });
    if (!code) return;

    await this.exchange(code.trim(), state);
  }

  handleUri(uri: vscode.Uri): void {
    // Fragments are not delivered to a UriHandler, so everything is in the query.
    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    const state = params.get('state');

    if (!this.pending) return;
    if (!code || state !== this.pending.state) {
      // A mismatched state means this callback belongs to a different attempt.
      this.pending.reject(new Error('Sign-in request did not match. Please try again.'));
      clearTimeout(this.pending.timer);
      this.pending = null;
      return;
    }

    clearTimeout(this.pending.timer);
    this.pending.resolve(code);
    this.pending = null;
  }

  async signOut(): Promise<void> {
    const refreshToken = await this.context.secrets.get(REFRESH_KEY);
    if (refreshToken) {
      // Best effort: the local tokens are cleared either way.
      await fetch(`${this.apiUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }

    await this.context.secrets.delete(ACCESS_KEY);
    await this.context.secrets.delete(REFRESH_KEY);
    this.onDidChangeEmitter.fire(false);
  }

  /**
   * Swaps the expired access token for a fresh pair.
   * Returns false when the refresh token is gone or rejected, so callers can
   * prompt for a new sign-in instead of retrying forever.
   */
  async refresh(): Promise<boolean> {
    const refreshToken = await this.context.secrets.get(REFRESH_KEY);
    if (!refreshToken) return false;

    const response = await fetch(`${this.apiUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);

    if (!response?.ok) {
      await this.signOut();
      return false;
    }

    const session = (await response.json()) as { accessToken: string; refreshToken: string };
    await this.store(session);
    return true;
  }

  private async exchange(code: string, state: string): Promise<void> {
    const response = await fetch(`${this.apiUrl()}/api/v1/auth/vscode/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(body?.error?.message ?? 'Sign-in failed. Please try again.');
    }

    await this.store((await response.json()) as { accessToken: string; refreshToken: string });
  }

  private async store(session: { accessToken: string; refreshToken: string }): Promise<void> {
    await this.context.secrets.store(ACCESS_KEY, session.accessToken);
    await this.context.secrets.store(REFRESH_KEY, session.refreshToken);
    this.onDidChangeEmitter.fire(true);
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    if (this.pending) clearTimeout(this.pending.timer);
  }
}
