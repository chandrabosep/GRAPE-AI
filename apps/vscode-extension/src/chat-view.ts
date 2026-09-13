import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ContentBlock } from '@aam/shared';
import type { ApiClient, ChatMessage } from './api';
import type { AuthManager } from './auth';
import { activeFileName, collectEditorContext, hasSelection } from './editor-context';
import type {
  ChatSession,
  HostState,
  HostToWebview,
  ModelChoice,
  PersistedTurn,
  WebviewToHost,
} from './protocol';
import type { SessionCoordinator } from './session-coordinator';
import { applyWrite, diffSummary, runTool, type PendingWrite } from './tools';

/**
 * The chat, as an editor tab.
 *
 * A custom webview rather than a Chat Participant, because the participant API
 * can only emit markdown and cannot render the sponsored slots as visually
 * distinct blocks. Keeping the ads unmistakably separate from the answer is the
 * product's core promise, so it drives the UI choice.
 *
 * A hidden webview cannot receive messages, so stream chunks are buffered here
 * and replayed when the view becomes visible again. Otherwise switching tabs
 * mid-answer silently loses the rest of the response.
 */

/** How long an account summary is reused before it is fetched again. */
/** Cursor moves fire continuously; one state push per settled selection is enough. */
const EDITOR_DEBOUNCE_MS = 150;

const ACCOUNT_TTL_MS = 10_000;

const MODEL_KEY = 'grapeAi.model';

export class ChatViewProvider {
  /** Also the webview panel's type id, which VS Code uses to restore the tab. */
  static readonly viewType = 'grapeAi.chat';

  private panel: vscode.WebviewPanel | undefined;
  private pending: HostToWebview[] = [];
  private history: ChatMessage[] = [];
  private inFlight: AbortController | null = null;
  private account: { value: Awaited<ReturnType<ApiClient['me']>>; at: number } | null = null;

  private readonly sessions: SessionCoordinator;
  /** Writes the model has proposed, keyed by tool-use id, awaiting a decision. */
  private readonly pendingWrites = new Map<
    string,
    { write: PendingWrite; settle: (approved: boolean) => void }
  >();
  private session: ChatSession | null = null;
  private models: ModelChoice[] = [];

  private readonly extensionUri: vscode.Uri;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly auth: AuthManager,
    private readonly api: ApiClient,
    private readonly apiUrl: () => string,
    sessions: SessionCoordinator,
  ) {
    this.extensionUri = context.extensionUri;
    this.sessions = sessions;

    // The account panel can open, rename or delete a conversation. Rather than
    // the two views calling each other, both act on the coordinator and this
    // reacts to whatever came out of it — including its own writes, which
    // reconcile to a no-op.
    context.subscriptions.push(this.sessions.onDidChange(() => void this.reconcile()));

    /**
     * Keeps the composer's context chips honest.
     *
     * `hasSelection` and the active file were only ever recomputed when
     * something else happened to push state, so the composer could claim a
     * selection was attached long after it was cleared, or name a file the
     * developer had navigated away from. Selection events fire on every cursor
     * move, so they are coalesced rather than pushed one for one.
     */
    let editorChange: ReturnType<typeof setTimeout> | undefined;
    const refreshEditorContext = () => {
      if (editorChange) clearTimeout(editorChange);
      editorChange = setTimeout(() => void this.pushState(), EDITOR_DEBOUNCE_MS);
    };
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(refreshEditorContext),
      vscode.window.onDidChangeTextEditorSelection(refreshEditorContext),
      new vscode.Disposable(() => {
        if (editorChange) clearTimeout(editorChange);
      }),
    );

    auth.onDidChange(() => {
      // A sign-in or sign-out changes what the account shows; the cache must not
      // outlive it. The model catalog is authenticated too, so it is refetched.
      this.account = null;
      this.models = [];
      void this.pushState();
    });
  }

  /**
   * Opens the chat as an editor tab, or reveals the one already open.
   *
   * An editor tab rather than a sidebar view: the transcript is the thing the
   * developer actually reads, and it was competing with the account panel for a
   * few hundred pixels. Here it gets the full editor, and the tab carries the
   * conversation's name so the window title says which chat is open.
   *
   * One tab, reused. The conversation is switched inside it rather than opened
   * beside it, because everything downstream of here — the transcript, the
   * request in flight, the pending writes — is per-instance state, and a second
   * tab would need a second set of all of it.
   */
  open(): void {
    if (this.panel) {
      this.panel.reveal(undefined, false);
      return;
    }

    this.adopt(
      vscode.window.createWebviewPanel(
        ChatViewProvider.viewType,
        this.session?.title ?? 'AI Chat',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        this.webviewOptions(),
      ),
    );
  }

  /**
   * Takes over a tab the editor restored after a window reload.
   *
   * Without this the reopened tab is a dead webview: VS Code puts the tab back
   * because it was open when the window closed, but nothing has wired up its
   * HTML or its messages, so it renders blank. The conversation itself survives
   * in the session store, so adopting the tab is enough to bring it back.
   */
  restore(panel: vscode.WebviewPanel): void {
    // A second chat tab cannot be served by this single instance, so the stale
    // one goes rather than being left blank and confusing.
    if (this.panel && this.panel !== panel) panel.dispose();
    else this.adopt(panel);
  }

  private webviewOptions(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      // The tab can be backgrounded mid-answer, and a hidden webview that got
      // torn down would lose the rest of the response.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
  }

  /** Wires a panel up, however it came into existence. */
  private adopt(panel: vscode.WebviewPanel): void {
    panel.webview.options = this.webviewOptions();
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    panel.webview.html = this.html(panel.webview);

    panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.handleMessage(message);
    });

    panel.onDidChangeViewState(() => {
      if (panel.visible) this.flush();
    });

    panel.onDidDispose(() => {
      // Closing the tab must not leave an answer streaming into nothing.
      this.inFlight?.abort();
      this.panel = undefined;
    });

    this.panel = panel;
    void this.pushState();
  }

  /** Opens the chat and pre-fills a prompt, used by editor context commands. */
  async ask(text: string): Promise<void> {
    this.open();
    await this.handleMessage({ type: 'send', id: randomUUID(), text });
  }

  /** Starts a fresh conversation, used by the command palette and the toolbar. */
  async newSession(): Promise<void> {
    this.open();
    await this.startNewSession();
  }

  private async handleMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const session = await this.currentSession();
        this.history = replayHistory(session.turns);
        this.post({ type: 'restore', sessionId: session.id, turns: session.turns });
        await this.pushState();
        return;
      }

      case 'persist':
        await this.sessions.saveTurns((await this.currentSession()).id, message.turns);
        // The switcher shows a title and a turn count, both of which just moved.
        await this.pushState();
        return;

      // These four only write. The coordinator announces the change and
      // `reconcile` does the reloading, so opening a conversation behaves
      // identically whether it was clicked here or in the account panel.
      case 'newSession':
        await this.startNewSession();
        return;

      case 'switchSession':
        if (!this.sessions.get(message.sessionId)) return;
        await this.sessions.setActive(message.sessionId);
        return;

      case 'renameSession':
        await this.sessions.rename(message.sessionId, message.title);
        return;

      case 'deleteSession':
        await this.sessions.remove(message.sessionId);
        return;

      case 'selectModel':
        await this.context.globalState.update(MODEL_KEY, message.modelId);
        await this.pushState();
        return;

      case 'setIncludeSelection':
        // Global rather than workspace-scoped: "do not send my selection" is a
        // statement about the person, not about one project.
        await vscode.workspace
          .getConfiguration('grapeAi')
          .update('includeSelection', message.value, vscode.ConfigurationTarget.Global);
        await this.pushState();
        return;

      case 'approveWrite':
        this.pendingWrites.get(message.toolUseId)?.settle(true);
        return;

      case 'rejectWrite':
        this.pendingWrites.get(message.toolUseId)?.settle(false);
        return;

      case 'reviewWrite': {
        // The editor's own diff view, rather than a rendering of one in the
        // panel: it is the tool the developer already reads diffs in, and it
        // shows the real file rather than our summary of it.
        const pending = this.pendingWrites.get(message.toolUseId);
        if (pending) await showProposedDiff(pending.write);
        return;
      }

      case 'send':
        await this.send(message.id, message.text, message.replaceLast === true);
        return;

      case 'cancel':
        this.inFlight?.abort();
        return;

      case 'adVisible': {
        // Confirmed attention is the only thing that pays the user. The grant
        // happens here rather than during the stream, because the money is owed
        // for attention that has already been evidenced, not for a card that was
        // merely sent.
        const outcome = await this.api.acknowledgeAd(message.impressionId, message.visibleMs);
        if (outcome?.granted) {
          this.account = null;
          this.post({
            type: 'reward',
            id: message.id,
            amountMicro: Number(outcome.amountMicro),
            balanceMicro: Number(outcome.balanceMicro ?? 0),
          });
        }
        await this.pushState();
        return;
      }

      case 'adClick': {
        const outcome = await this.api.clickAd(message.impressionId);
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
        if (outcome?.granted) {
          this.account = null;
          this.post({
            type: 'reward',
            id: message.id,
            amountMicro: Number(outcome.amountMicro),
            balanceMicro: Number(outcome.balanceMicro ?? 0),
          });
        }
        await this.pushState();
        return;
      }

      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: 'notice', text: 'Copied to clipboard' });
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
        await vscode.commands.executeCommand('grapeAi.signIn');
        return;

      case 'openDashboard':
        await vscode.commands.executeCommand('grapeAi.openDashboard');
        return;
    }
  }

  private async startNewSession(): Promise<void> {
    // `create` makes the new conversation active, which reconcile then opens.
    await this.sessions.create();
  }

  /**
   * Brings the panel in line with the coordinator.
   *
   * Called after any session change, from either view. The guard is what makes
   * it safe to run on our own writes: if the open conversation is already the
   * active one there is nothing to restore, and only the header and the
   * switcher need refreshing.
   */
  private async reconcile(): Promise<void> {
    const activeId = this.sessions.activeId();

    if (activeId !== null && activeId !== this.session?.id) {
      // A half-finished answer belongs to the conversation being left, not the
      // one being opened.
      this.inFlight?.abort();

      const target = this.sessions.get(activeId);
      if (target) {
        this.session = target;
        this.history = replayHistory(target.turns);
        this.post({ type: 'restore', sessionId: target.id, turns: target.turns });
      }
    } else if (this.session) {
      // Same conversation, but its title or turn count may have moved.
      this.session = this.sessions.get(this.session.id) ?? this.session;
    }

    // The tab is how the developer knows which conversation they are in, and
    // an untitled one gets its name from its first question, so this has to
    // follow every change rather than being set once at open().
    if (this.panel && this.session) this.panel.title = this.session.title;

    await this.pushState();
  }

  /** The open conversation, creating the very first one on demand. */
  private async currentSession(): Promise<ChatSession> {
    this.session ??= this.sessions.active() ?? (await this.sessions.create());
    return this.session;
  }

  private async send(id: string, text: string, replaceLast = false): Promise<void> {
    if (!(await this.auth.isSignedIn())) {
      this.post({ type: 'error', id, message: 'Sign in to use the assistant.' });
      return;
    }

    const session = await this.currentSession();

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    // A regenerate must not leave the discarded exchange in the context, or the
    // model answers a question it can already see it has answered.
    if (replaceLast) {
      this.dropLastExchange();
    }

    this.history.push({ role: 'user', content: text });

    try {
      await this.runAgent(id, session.id, controller);
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
      // The answer was just paid for, so the balance on screen is stale.
      this.account = null;
      await this.pushState();
    }
  }

  /**
   * The agent loop.
   *
   * The server cannot run tools — it has no access to this machine — so it ends
   * its turn the moment the model asks for one and streams the request down to
   * us. We execute it here and open a *new* request carrying the result. Each
   * pass is therefore a complete round trip, which is what makes an agent
   * possible over a one-way SSE stream without holding a socket open.
   *
   * The hop limit is a safety rail, not a tuning knob: a model that keeps
   * calling tools without converging would otherwise bill the developer
   * indefinitely, one paid request per hop.
   */
  private async runAgent(
    id: string,
    sessionId: string,
    controller: AbortController,
  ): Promise<void> {
    const includeSelection = vscode.workspace
      .getConfiguration('grapeAi')
      .get<boolean>('includeSelection', true);

    const maxHops = vscode.workspace.getConfiguration('grapeAi').get<number>('maxToolSteps', 12);

    for (let hop = 0; hop < maxHops; hop += 1) {
      if (controller.signal.aborted) return;

      let assistantText = '';
      const calls: { toolUseId: string; name: string; input: unknown }[] = [];
      const serverToolResults: ContentBlock[] = [];

      for await (const event of this.api.chat(
        this.history,
        // Editor context only matters for the question itself. Re-sending the
        // selection on every hop would drown the tool results in it.
        hop === 0 ? collectEditorContext(includeSelection) : undefined,
        { model: this.selectedModel(), sessionId, tools: true },
        controller.signal,
      )) {
        switch (event.type) {
          case 'delta':
            assistantText += event.text;
            this.post({ type: 'delta', id, text: event.text });
            break;
          case 'tool_use':
            calls.push({
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
            });
            break;
          case 'tool_result':
            // Server-side tool (e.g. query_blockchain): the server already
            // executed it and sent the result. Record it so it is included
            // in the conversation history for the next hop.
            calls.push({
              toolUseId: event.toolUseId,
              name: event.name,
              input: {},
            });
            serverToolResults.push({
              type: 'tool_result' as const,
              toolUseId: event.toolUseId,
              content: event.content,
              isError: event.isError,
            });
            break;
          case 'server_tool':
            // Presentational only: the server already ran it and the model has
            // already seen the result, so this touches the trail and nothing
            // else. Keyed by tool-use id, so the running row becomes the
            // finished one in place instead of stacking up as two.
            this.post({
              type: 'tool',
              id,
              activity: {
                id: event.toolUseId,
                name: event.name,
                summary: event.summary,
                status: event.status,
                ...(event.detail ? { detail: event.detail } : {}),
                ...(event.query ? { query: event.query } : {}),
              },
            });
            break;
          case 'ad':
            this.post({ type: 'ad', id, ad: event.ad });
            break;
          case 'ad_skipped':
            // The panel no longer narrates an empty slot, so there is nothing
            // to forward. The server still records the reason.
            break;
          case 'usage':
            this.post({
              type: 'usage',
              id,
              totalTokens: event.usage.totalTokens,
              costMicro: event.usage.costMicro,
              model: event.usage.model,
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
            return;
          default:
            break;
        }
      }

      // The assistant's turn is recorded whole — its text and the calls it made
      // — because the model needs to see its own request to make sense of the
      // result that answers it.
      const assistantBlocks: ContentBlock[] = [
        ...(assistantText.trim() ? [{ type: 'text' as const, text: assistantText }] : []),
        ...calls.map((call) => ({ type: 'tool_use' as const, ...call })),
      ];
      if (assistantBlocks.length > 0) {
        this.history.push({ role: 'assistant', content: assistantBlocks });
      }

      if (calls.length === 0) return;

      // Server-side tools (query_blockchain) are already resolved — only run
      // the client-side ones (read_file, write_file, …) locally.
      const clientCalls = calls.filter(
        (c) =>
          !serverToolResults.some((r) => r.type === 'tool_result' && r.toolUseId === c.toolUseId),
      );

      const clientResults =
        clientCalls.length > 0 ? await this.executeCalls(id, clientCalls, controller) : [];
      if (controller.signal.aborted) return;

      const results = [...serverToolResults, ...clientResults];

      this.history.push({ role: 'user', content: results });
    }

    this.post({
      type: 'error',
      id,
      message:
        'The assistant kept using tools without reaching an answer, so it was stopped. ' +
        'Try narrowing the question.',
    });
  }

  /**
   * Runs the tools a turn asked for.
   *
   * Reads run immediately. Writes are *proposed* first — every one of them —
   * and only then awaited, so a turn that creates four files shows four cards
   * at once and can be approved in a single decision. Awaiting each write as it
   * came would reveal them one at a time, turning "build me an app" into a
   * sequence of interruptions with no way to see the whole change.
   */
  private async executeCalls(
    turnId: string,
    calls: { toolUseId: string; name: string; input: unknown }[],
    controller: AbortController,
  ): Promise<ContentBlock[]> {
    const results = new Map<string, ContentBlock>();
    const decisions: Promise<void>[] = [];

    for (const call of calls) {
      if (controller.signal.aborted) break;

      const summary = describeCall(call.name, call.input);
      this.post({
        type: 'tool',
        id: turnId,
        activity: { id: call.toolUseId, name: call.name, summary, status: 'running' },
      });

      const outcome = await runTool(call.name, call.input);

      if (outcome.pendingWrite) {
        // Registered and shown now; decided later, alongside its siblings.
        decisions.push(
          this.awaitWriteDecision(
            turnId,
            call.toolUseId,
            summary,
            outcome.pendingWrite,
            controller,
          ).then((decision) => {
            results.set(call.toolUseId, {
              type: 'tool_result',
              toolUseId: call.toolUseId,
              content: decision.content,
              isError: decision.isError,
            });
          }),
        );
        continue;
      }

      this.post({
        type: 'tool',
        id: turnId,
        activity: {
          id: call.toolUseId,
          name: call.name,
          summary,
          status: outcome.isError ? 'error' : 'done',
          ...(outcome.isError ? { detail: outcome.content } : {}),
        },
      });

      results.set(call.toolUseId, {
        type: 'tool_result',
        toolUseId: call.toolUseId,
        content: outcome.content,
        isError: outcome.isError,
      });
    }

    await Promise.all(decisions);

    // Back into the order the model asked for them. Results are matched by id,
    // but a stable order keeps the transcript readable.
    return calls
      .map((call) => results.get(call.toolUseId))
      .filter((block): block is ContentBlock => block !== undefined);
  }

  /**
   * Holds a write until the developer approves or refuses it.
   *
   * A rejection is reported to the model as a normal, non-error result. It is
   * not a failure — the developer simply said no — and framing it as an error
   * makes the model apologise and retry the same write instead of asking what
   * they would prefer.
   */
  private awaitWriteDecision(
    turnId: string,
    toolUseId: string,
    summary: string,
    write: PendingWrite,
    controller: AbortController,
  ): Promise<{ content: string; isError: boolean }> {
    const { added, removed } = diffSummary(write);
    const detail = `+${added} −${removed}`;

    this.post({
      type: 'tool',
      id: turnId,
      activity: {
        id: toolUseId,
        name: 'write_file',
        summary,
        status: 'awaiting-approval',
        detail,
      },
    });

    return new Promise((resolve) => {
      const settle = async (approved: boolean) => {
        this.pendingWrites.delete(toolUseId);

        if (!approved) {
          this.post({
            type: 'tool',
            id: turnId,
            activity: {
              id: toolUseId,
              name: 'write_file',
              summary,
              status: 'rejected',
              detail,
            },
          });
          resolve({
            content:
              `The developer declined the change to "${write.path}". Do not try the same ` +
              'write again — ask what they would prefer, or explain the change instead.',
            isError: false,
          });
          return;
        }

        const applied = await applyWrite(write);
        this.post({
          type: 'tool',
          id: turnId,
          activity: {
            id: toolUseId,
            name: 'write_file',
            summary,
            status: applied.isError ? 'error' : 'applied',
            detail: applied.isError ? applied.content : detail,
          },
        });
        resolve(applied);
      };

      this.pendingWrites.set(toolUseId, { write, settle });

      // Cancelling the turn must not leave the loop waiting on a button that is
      // no longer on screen.
      controller.signal.addEventListener(
        'abort',
        () => {
          if (this.pendingWrites.delete(toolUseId)) {
            resolve({ content: 'The developer cancelled this turn.', isError: false });
          }
        },
        { once: true },
      );
    });
  }

  private dropLastExchange(): void {
    // A tool-using answer spans several messages, so "the last exchange" runs
    // back to the previous thing the developer actually typed, not one message.
    while (this.history.length > 0) {
      const last = this.history[this.history.length - 1]!;
      const isHumanQuestion =
        last.role === 'user' &&
        (typeof last.content === 'string' || last.content.some((block) => block.type === 'text'));

      this.history.pop();
      if (isHumanQuestion) return;
    }
  }

  /**
   * The chosen model, or none.
   *
   * Returns null rather than guessing a default: the server owns that decision,
   * and a stored id from an older deployment must not pin the client to a model
   * that no longer exists.
   */
  private selectedModel(): string | null {
    const stored = this.context.globalState.get<string>(MODEL_KEY);
    if (!stored) return null;
    if (this.models.length > 0 && !this.models.some((model) => model.id === stored)) return null;
    return stored;
  }

  private async pushState(): Promise<void> {
    const signedIn = await this.auth.isSignedIn();
    const account = signedIn ? await this.accountSummary() : null;

    if (signedIn && this.models.length === 0) {
      this.models = await this.api.models();
    }

    const state: HostState = {
      signedIn,
      creditBalanceMicro: account?.creditBalanceMicro ?? null,
      hasSelection: hasSelection(),
      includeSelection: vscode.workspace
        .getConfiguration('grapeAi')
        .get<boolean>('includeSelection', true),
      activeFileName: activeFileName(),
      models: this.models,
      selectedModel: this.selectedModel() ?? this.models.find((model) => model.default)?.id ?? null,
      sessions: this.sessions.summaries(),
      activeSessionId: this.session?.id ?? null,
    };

    this.post({ type: 'state', state });
  }

  /**
   * The account summary, cached for a few seconds.
   *
   * Every ad acknowledgement and every finished answer pushes state, and each
   * push was costing a full round trip to /me. The balance only moves when we
   * ourselves spend or earn, so both of those paths invalidate the cache.
   */
  private async accountSummary(): Promise<Awaited<ReturnType<ApiClient['me']>>> {
    if (this.account && Date.now() - this.account.at < ACCOUNT_TTL_MS) {
      return this.account.value;
    }
    const value = await this.api.me();
    this.account = { value, at: Date.now() };
    return value;
  }

  private post(message: HostToWebview): void {
    // Buffer while hidden: postMessage to a hidden webview is dropped.
    if (!this.panel?.visible) {
      this.pending.push(message);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private flush(): void {
    const queued = this.pending;
    this.pending = [];
    for (const message of queued) void this.panel?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const nonce = randomUUID().replace(/-/g, '');

    // Creative artwork is served by the API origin, which is plain http in local
    // development, so it has to be named explicitly rather than covered by https:.
    let assetOrigin = '';
    try {
      assetOrigin = new URL(this.apiUrl()).origin;
    } catch {
      assetOrigin = '';
    }

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} ${assetOrigin} https: data:;" />
    <title>GRAPE AI</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}

/**
 * Rebuilds the model's view of a restored conversation.
 *
 * Without this, switching back to an earlier session and asking a follow-up
 * sends only the new question — the assistant has no idea what "it" refers to,
 * even though the developer can see the whole exchange on screen.
 */
function replayHistory(turns: PersistedTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    messages.push({ role: 'user', content: turn.question });
    if (turn.answer) messages.push({ role: 'assistant', content: turn.answer });
  }
  return messages;
}

/**
 * A short, honest label for a tool call.
 *
 * The developer should be able to read the panel and know exactly which files
 * the assistant touched, so this names the target rather than the action.
 */
function describeCall(name: string, input: unknown): string {
  const argument = (input ?? {}) as Record<string, unknown>;

  if (name === 'search_files') {
    const query = typeof argument.query === 'string' ? argument.query : '';
    const glob = typeof argument.glob === 'string' ? ` in ${argument.glob}` : '';
    return `"${query}"${glob}`;
  }

  if (name === 'list_directory') {
    const path = typeof argument.path === 'string' && argument.path ? argument.path : '.';
    return path;
  }

  const path = typeof argument.path === 'string' ? argument.path : '';
  if (name === 'read_file' && typeof argument.startLine === 'number') {
    const end = typeof argument.endLine === 'number' ? argument.endLine : '';
    return `${path}:${argument.startLine}${end ? `-${end}` : ''}`;
  }

  return path || name;
}

/**
 * Opens a proposed write in the editor's diff view.
 *
 * The proposal is shown from an in-memory document rather than written to a
 * temporary file, because nothing the developer has not approved should reach
 * disk — not even somewhere harmless.
 */
async function showProposedDiff(write: PendingWrite): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;

  const current = root
    ? vscode.Uri.joinPath(root, write.path)
    : vscode.Uri.parse(`untitled:${write.path}`);

  const proposed = vscode.Uri.parse(`${PROPOSED_SCHEME}:/${write.path}?${Date.now()}`);
  proposedContents.set(proposed.path, write.content);

  const left = write.previous === null ? vscode.Uri.parse('untitled:empty') : current;

  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    proposed,
    `${write.path} — proposed change`,
    { preview: true },
  );
}

/** Backing store for the read-only documents the diff view renders. */
const proposedContents = new Map<string, string>();

export const PROPOSED_SCHEME = 'aam-proposed';

/** Serves proposed file contents to the diff view without touching disk. */
export const proposedContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri) {
    return proposedContents.get(uri.path) ?? '';
  },
};
