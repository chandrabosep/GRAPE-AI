import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ApiClient, ChatMessage } from './api';
import type { AuthManager } from './auth';
import { collectEditorContext, hasSelection } from './editor-context';
import type { HostState, HostToWebview, WebviewToHost } from './protocol';

/**
 * The chat sidebar.
 *
 * A custom webview rather than a Chat Participant, because the participant API
 * can only emit markdown and cannot render the sponsored card as a visually
 * distinct block. Keeping the ad unmistakably separate from the answer is the
 * product's core promise, so it drives the UI choice.
 *
 * A hidden webview cannot receive messages, so stream chunks are buffered here
 * and replayed when the view becomes visible again. Otherwise switching tabs
 * mid-answer silently loses the rest of the response.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aiMarketplace.chat';

  private view: vscode.WebviewView | undefined;
  private pending: HostToWebview[] = [];
  private history: ChatMessage[] = [];
  private inFlight: AbortController | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly auth: AuthManager,
    private readonly api: ApiClient,
  ) {
    auth.onDidChange(() => void this.pushState());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.handleMessage(message);
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.flush();
    });

    void this.pushState();
  }

  /** Focuses the chat and pre-fills a prompt, used by editor context commands. */
  async ask(text: string): Promise<void> {
    await vscode.commands.executeCommand('aiMarketplace.chat.focus');
    await this.handleMessage({ type: 'send', id: randomUUID(), text });
  }

  private async handleMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.pushState();
        return;

      case 'send':
        await this.send(message.id, message.text);
        return;

      case 'cancel':
        this.inFlight?.abort();
        return;

      case 'adVisible':
        // Confirmed attention is the only thing that pays the user.
        await this.api.acknowledgeAd(message.impressionId, message.visibleMs);
        await this.pushState();
        return;

      case 'adClick':
        await this.api.clickAd(message.impressionId);
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
        await this.pushState();
        return;

      case 'adDismiss':
        await this.api.dismissAd(message.impressionId);
        return;

      case 'insertCode': {
        // Only ever on an explicit user action; nothing is written to the
        // editor on its own.
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        await editor.edit((edit) => edit.replace(editor.selection, message.code));
        return;
      }

      case 'signIn':
        await vscode.commands.executeCommand('aiMarketplace.signIn');
        return;

      case 'openDashboard':
        await vscode.commands.executeCommand('aiMarketplace.openDashboard');
        return;
    }
  }

  private async send(id: string, text: string): Promise<void> {
    if (!(await this.auth.isSignedIn())) {
      this.post({ type: 'error', id, message: 'Sign in to use the assistant.' });
      return;
    }

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    this.history.push({ role: 'user', content: text });

    const includeSelection = vscode.workspace
      .getConfiguration('aiMarketplace')
      .get<boolean>('includeSelection', true);

    let assistant = '';

    try {
      for await (const event of this.api.chat(
        this.history,
        collectEditorContext(includeSelection),
        controller.signal,
      )) {
        switch (event.type) {
          case 'delta':
            assistant += event.text;
            this.post({ type: 'delta', id, text: event.text });
            break;
          case 'ad':
            this.post({ type: 'ad', id, ad: event.ad });
            break;
          case 'usage':
            this.post({
              type: 'usage',
              id,
              totalTokens: event.usage.totalTokens,
              costMicro: event.usage.costMicro,
            });
            break;
          case 'reward':
            this.post({
              type: 'reward',
              id,
              amountMicro: event.reward.amountMicro,
              balanceMicro: event.reward.creditBalanceMicro,
            });
            break;
          case 'error':
            this.post({ type: 'error', id, message: event.message });
            break;
          default:
            break;
        }
      }

      if (assistant) this.history.push({ role: 'assistant', content: assistant });
    } catch (error) {
      if (!controller.signal.aborted) {
        this.post({
          type: 'error',
          id,
          message: error instanceof Error ? error.message : 'The request failed.',
        });
      }
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
      this.post({ type: 'done', id });
      await this.pushState();
    }
  }

  private async pushState(): Promise<void> {
    const signedIn = await this.auth.isSignedIn();
    const account = signedIn ? await this.api.me() : null;

    const state: HostState = {
      signedIn,
      creditBalanceMicro: account?.creditBalanceMicro ?? null,
      hasSelection: hasSelection(),
      includeSelection: vscode.workspace
        .getConfiguration('aiMarketplace')
        .get<boolean>('includeSelection', true),
    };

    this.post({ type: 'state', state });
  }

  private post(message: HostToWebview): void {
    // Buffer while hidden: postMessage to a hidden webview is dropped.
    if (!this.view?.visible) {
      this.pending.push(message);
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flush(): void {
    const queued = this.pending;
    this.pending = [];
    for (const message of queued) void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const nonce = randomUUID().replace(/-/g, '');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;" />
    <title>AI Marketplace</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}
