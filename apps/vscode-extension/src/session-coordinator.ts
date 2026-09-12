import type * as vscode from 'vscode';
import type { ChatSession, PersistedTurn, SessionSummary } from './protocol';
import { SessionStore } from './sessions';

/**
 * Shared conversation state for the two views that can both change it.
 *
 * The store used to be private to the chat provider, which was correct while
 * the chat was the only thing that could switch a conversation. The account
 * panel can too, and two independent `SessionStore` instances over the same
 * `globalState` would each be blind to the other's writes — the panel would
 * show a title the chat had already changed, and a rename made in one would be
 * overwritten by the next write from the other.
 *
 * So there is exactly one store, and it announces every change. Neither view
 * reaches into the other: they both act on this, and both listen to it. What a
 * listener does with the news is its own business — the chat reloads its
 * transcript when the open conversation changes, the panel just re-renders its
 * list.
 *
 * The method names deliberately match `SessionStore`'s, so this is a drop-in
 * replacement at the call sites rather than a rewrite of them.
 */
export class SessionCoordinator {
  private readonly store: SessionStore;
  /**
   * Each subscription is wrapped so it is its own entry.
   *
   * A set of the bare functions would collapse two registrations of the same
   * function into one, and then disposing either would unsubscribe the other —
   * a view could go silently dead because something unrelated cleaned up.
   */
  private readonly listeners = new Set<{ readonly call: () => void }>();

  constructor(memento: vscode.Memento) {
    this.store = new SessionStore(memento);
  }

  /**
   * Subscribes to session changes.
   *
   * Returns a disposable rather than taking an owner, so it can go straight
   * into `context.subscriptions` like every other registration.
   */
  onDidChange(listener: () => void): { dispose(): void } {
    const entry = { call: listener };
    this.listeners.add(entry);
    return {
      dispose: () => {
        this.listeners.delete(entry);
      },
    };
  }

  // --- reads -----------------------------------------------------------------

  summaries(): SessionSummary[] {
    return this.store.summaries();
  }

  get(sessionId: string): ChatSession | null {
    return this.store.get(sessionId);
  }

  active(): ChatSession | null {
    return this.store.active();
  }

  /**
   * The open conversation's id.
   *
   * Resolved through the store rather than read from the key directly, so a
   * stored id pointing at a deleted conversation falls back the same way
   * opening the panel would.
   */
  activeId(): string | null {
    return this.store.active()?.id ?? null;
  }

  // --- writes ----------------------------------------------------------------
  //
  // Every one of these notifies, including `saveTurns`: a saved turn is what
  // gives an untitled conversation its name and moves it to the top of the
  // list, which is a visible change even though no conversation was opened or
  // closed.

  async create(): Promise<ChatSession> {
    const session = await this.store.create();
    this.notify();
    return session;
  }

  async setActive(sessionId: string): Promise<void> {
    await this.store.setActive(sessionId);
    this.notify();
  }

  async saveTurns(sessionId: string, turns: PersistedTurn[]): Promise<void> {
    await this.store.saveTurns(sessionId, turns);
    this.notify();
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.store.rename(sessionId, title);
    this.notify();
  }

  async remove(sessionId: string): Promise<ChatSession | null> {
    const next = await this.store.remove(sessionId);
    this.notify();
    return next;
  }

  /**
   * A listener that throws must not stop the others from being told, or a
   * render error in one view would silently freeze the other's list.
   */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener.call();
      } catch {
        // A view that cannot handle the change is not this class's problem.
      }
    }
  }
}
