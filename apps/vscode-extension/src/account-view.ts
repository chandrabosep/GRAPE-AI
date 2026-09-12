import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ApiClient } from './api';
import type { AuthManager } from './auth';
import type { AccountHostToWebview, AccountState, AccountWebviewToHost } from './protocol';
import type { SessionCoordinator } from './session-coordinator';

/**
 * The account and sessions panel.
 *
 * Two things the chat cannot show well. Money, because a balance and what it
 * is worth belong somewhere stable rather than in a header that scrolls away;
 * and the conversation list, which was a dropdown precisely because a standing
 * list would have taken room from the transcript. In its own view it costs the
 * transcript nothing.
 *
 * Session actions are not handled here. They go to the coordinator, which
 * tells the chat, which reloads its transcript — so clicking a conversation in
 * this panel opens it over there without the two views knowing about each other.
 */

/** Polled only while visible; a hidden webview refreshing is pure waste. */
const REFRESH_MS = 60_000;

export class AccountViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aiMarketplace.account';

  private view: vscode.WebviewView | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Last good figures, kept so a failed refresh can be marked stale rather than blanked. */
  private last: Awaited<ReturnType<ApiClient['me']>> = null;

  private readonly extensionUri: vscode.Uri;

  constructor(
    context: vscode.ExtensionContext,
    private readonly auth: AuthManager,
    private readonly api: ApiClient,
    private readonly sessions: SessionCoordinator,
  ) {
    this.extensionUri = context.extensionUri;

    context.subscriptions.push(
      // A rename or a new conversation in the chat must show up here too.
      this.sessions.onDidChange(() => void this.push()),
      auth.onDidChange(() => {
        this.last = null;
        void this.push();
      }),
      { dispose: () => this.stopPolling() },
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((message: AccountWebviewToHost) => {
      void this.handleMessage(message);
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.push();
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });

    view.onDidDispose(() => {
      this.stopPolling();
      this.view = undefined;
    });

    if (view.visible) this.startPolling();
  }

  /** Called after a turn finishes, when the balance has actually moved. */
  refresh(): void {
    void this.push(true);
  }

  private async handleMessage(message: AccountWebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.push(true);
        return;

      // The four session actions. Each one only writes; the chat hears about it
      // from the coordinator and does the reloading.
      case 'newSession':
        await this.sessions.create();
        await vscode.commands.executeCommand('aiMarketplace.openChat');
        return;

      case 'switchSession':
        await this.sessions.setActive(message.sessionId);
        await vscode.commands.executeCommand('aiMarketplace.openChat');
        return;

      case 'renameSession':
        await this.sessions.rename(message.sessionId, message.title);
        return;

      case 'deleteSession':
        await this.sessions.remove(message.sessionId);
        return;

      case 'signIn':
        await vscode.commands.executeCommand('aiMarketplace.signIn');
        return;

      case 'openDashboard':
        await vscode.commands.executeCommand('aiMarketplace.openDashboard');
        return;

      case 'topUp':
        await vscode.commands.executeCommand('aiMarketplace.topUp');
        return;

      case 'withdraw':
        await vscode.commands.executeCommand('aiMarketplace.withdraw');
        return;
    }
  }

  /**
   * Sends the panel its state.
   *
   * `force` refetches; otherwise the last known figures are reused, because a
   * session rename should not cost a round trip to /me.
   */
  private async push(force = false): Promise<void> {
    if (!this.view) return;

    const signedIn = await this.auth.isSignedIn();

    let offline = false;
    if (!signedIn) {
      this.last = null;
    } else if (force || this.last === null) {
      const fresh = await this.api.me();
      if (fresh) this.last = fresh;
      else offline = true;
    }

    const config = signedIn ? await this.api.config() : null;
    const account = this.last;

    const state: AccountState = {
      signedIn,
      offline,
      email: account?.email ?? null,
      displayName: account?.displayName ?? null,
      creditBalanceMicro: account?.creditBalanceMicro ?? null,
      withdrawableMicro: account?.withdrawableMicro ?? null,
      minPayoutMicro: config?.minPayoutMicro ?? null,
      todayTokens: account?.todayTokens ?? null,
      todayCostMicro: account?.todayCostMicro ?? null,
      requestsToday: account?.requestsToday ?? null,
      sessions: this.sessions.summaries(),
      activeSessionId: this.sessions.activeId(),
    };

    this.post({ type: 'account', state });
  }

  private post(message: AccountHostToWebview): void {
    if (!this.view?.visible) return;
    void this.view.webview.postMessage(message);
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.push(true), REFRESH_MS);
  }

  private stopPolling(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'account.js'),
    );
    const nonce = randomUUID().replace(/-/g, '');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;" />
    <title>Account &amp; Sessions</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}
