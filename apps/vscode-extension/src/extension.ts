import * as vscode from 'vscode';
import { ApiClient } from './api';
import { AuthManager } from './auth';
import { ChatViewProvider } from './chat-view';
import { StatusBar } from './status-bar';

/**
 * AI Attention Marketplace — VS Code extension.
 *
 * A Cursor-style assistant denominated in credits, where a clearly separated
 * sponsored card appears while the answer streams and pays for the next request.
 *
 * The extension holds no secrets: no API key, no wallet, no Privy credential.
 * It exchanges a browser-minted one-time code for a session and stores that in
 * the OS keychain via SecretStorage.
 */
export function activate(context: vscode.ExtensionContext): void {
  const apiUrl = () =>
    vscode.workspace
      .getConfiguration('aiMarketplace')
      .get<string>('apiUrl', 'http://localhost:3000')
      .replace(/\/$/, '');

  const auth = new AuthManager(context, apiUrl);
  const api = new ApiClient(apiUrl, auth);
  const chat = new ChatViewProvider(context.extensionUri, auth, api);
  const statusBar = new StatusBar(auth, api);

  context.subscriptions.push(
    auth,
    statusBar,

    // Only one handler per extension; it receives the browser sign-in callback.
    vscode.window.registerUriHandler({
      handleUri: (uri) => auth.handleUri(uri),
    }),

    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand('aiMarketplace.signIn', async () => {
      try {
        await auth.signIn();
        void vscode.window.showInformationMessage('Signed in to AI Marketplace.');
        await statusBar.refresh();
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Sign-in failed.',
        );
      }
    }),

    vscode.commands.registerCommand('aiMarketplace.enterCode', async () => {
      try {
        await auth.signInWithPastedCode();
        await statusBar.refresh();
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error ? error.message : 'Sign-in failed.',
        );
      }
    }),

    vscode.commands.registerCommand('aiMarketplace.signOut', async () => {
      await auth.signOut();
      await statusBar.refresh();
      void vscode.window.showInformationMessage('Signed out.');
    }),

    vscode.commands.registerCommand('aiMarketplace.openChat', async () => {
      await vscode.commands.executeCommand('aiMarketplace.chat.focus');
    }),

    vscode.commands.registerCommand('aiMarketplace.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showInformationMessage('Select some code first.');
        return;
      }
      await chat.ask('Explain what this code does, and flag anything that looks wrong.');
    }),

    vscode.commands.registerCommand('aiMarketplace.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(`${apiUrl()}/app`));
    }),
  );

  void statusBar.refresh();
}

export function deactivate(): void {
  // Everything is registered through context.subscriptions.
}
