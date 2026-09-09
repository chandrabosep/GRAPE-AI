import * as vscode from 'vscode';
import type { ApiClient } from './api';
import type { AuthManager } from './auth';

/**
 * Credit balance in the status bar.
 *
 * Credits are the only currency, so the balance is the one number a developer
 * needs at a glance: it is what lets them keep asking questions.
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly auth: AuthManager,
    private readonly api: ApiClient,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'aiMarketplace.openChat';
    this.item.show();

    auth.onDidChange(() => void this.refresh());
    // Rewards land asynchronously after an ad is confirmed, so poll gently.
    this.timer = setInterval(() => void this.refresh(), 60_000);
  }

  async refresh(): Promise<void> {
    if (!(await this.auth.isSignedIn())) {
      this.item.text = '$(sparkle) Sign in';
      this.item.tooltip = 'Sign in to AI Marketplace';
      this.item.command = 'aiMarketplace.signIn';
      return;
    }

    this.item.command = 'aiMarketplace.openChat';

    const account = await this.api.me();
    if (!account) {
      this.item.text = '$(sparkle) AI Marketplace';
      this.item.tooltip = 'Could not reach the marketplace';
      return;
    }

    const credits = Number(account.creditBalanceMicro) / 1_000_000;
    this.item.text = `$(sparkle) $${credits.toFixed(4)}`;
    this.item.tooltip = new vscode.MarkdownString(
      [
        `**AI credits:** $${credits.toFixed(4)}`,
        `**Tokens today:** ${account.todayTokens.toLocaleString()}`,
        '',
        'Credits are spent on inference and earned from sponsored content.',
      ].join('\n'),
    );
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
