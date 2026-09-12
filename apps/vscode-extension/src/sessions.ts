import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import type { ChatSession, PersistedTurn, SessionSummary } from './protocol';

/**
 * Conversation storage.
 *
 * Sessions live in the extension's own globalState and are never sent anywhere.
 * That is not an implementation shortcut: the schema on the server has no table
 * that can hold a prompt or a reply, so the only place a conversation can
 * honestly live is the developer's machine. The server is told a `sessionId`
 * and nothing else, which is enough to scope usage and ad frequency without
 * ever being able to reconstruct what was said.
 *
 * A previous version stored one flat list of turns. Migrating it rather than
 * dropping it matters — those conversations are the developer's, and an upgrade
 * that quietly empties the panel reads as data loss.
 */

const SESSIONS_KEY = 'grapeAi.sessions';
const ACTIVE_KEY = 'grapeAi.activeSession';
/** Legacy single-conversation storage, read once and migrated. */
const LEGACY_TURNS_KEY = 'grapeAi.turns';

/** Beyond this a conversation is trimmed from the front. */
const MAX_TURNS_PER_SESSION = 50;
/** Beyond this the least recently used conversation is dropped. */
const MAX_SESSIONS = 40;

const UNTITLED = 'New chat';

/**
 * A conversation's name, taken from its opening question.
 *
 * Cut on a word boundary: a title chopped mid-word reads as a rendering bug
 * rather than an abbreviation.
 */
export function deriveTitle(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return UNTITLED;
  if (flat.length <= 48) return flat;

  const cut = flat.slice(0, 48);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 24 ? cut.slice(0, lastSpace) : cut}…`;
}

export class SessionStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Every session, most recently used first. */
  list(): ChatSession[] {
    const stored = this.memento.get<ChatSession[]>(SESSIONS_KEY);
    if (stored && stored.length > 0) {
      return [...stored].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    const legacy = this.memento.get<PersistedTurn[]>(LEGACY_TURNS_KEY, []);
    if (legacy.length === 0) return [];

    // One pre-sessions conversation, preserved under a name of its own.
    const now = Date.now();
    return [
      {
        id: randomUUID(),
        title: deriveTitle(legacy[0]?.question ?? UNTITLED),
        createdAt: now,
        updatedAt: now,
        turns: legacy,
      },
    ];
  }

  summaries(): SessionSummary[] {
    return this.list().map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      turnCount: session.turns.length,
    }));
  }

  get(sessionId: string): ChatSession | null {
    return this.list().find((session) => session.id === sessionId) ?? null;
  }

  /**
   * The conversation to show on open.
   *
   * Falls back to the most recent rather than to nothing: reopening the panel
   * and finding an empty one, with the previous conversation reachable only
   * through a menu, is not what "where I left off" means.
   */
  active(): ChatSession | null {
    const activeId = this.memento.get<string>(ACTIVE_KEY);
    const sessions = this.list();
    if (sessions.length === 0) return null;
    return sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  }

  async create(): Promise<ChatSession> {
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      title: UNTITLED,
      createdAt: now,
      updatedAt: now,
      turns: [],
    };

    await this.write([session, ...this.list()]);
    await this.setActive(session.id);
    return session;
  }

  async setActive(sessionId: string): Promise<void> {
    await this.memento.update(ACTIVE_KEY, sessionId);
  }

  /**
   * Writes a conversation's turns.
   *
   * Also names the session from its first question, once. Renaming on every
   * write would overwrite a title the developer had deliberately set.
   */
  async saveTurns(sessionId: string, turns: PersistedTurn[]): Promise<void> {
    const sessions = this.list();
    const existing = sessions.find((session) => session.id === sessionId);
    if (!existing) return;

    existing.turns = turns.slice(-MAX_TURNS_PER_SESSION);
    existing.updatedAt = Date.now();
    if (existing.title === UNTITLED && turns.length > 0) {
      existing.title = deriveTitle(turns[0]!.question);
    }

    await this.write(sessions);
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const sessions = this.list();
    const existing = sessions.find((session) => session.id === sessionId);
    if (!existing) return;

    const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    existing.title = trimmed.length > 0 ? trimmed : UNTITLED;
    await this.write(sessions);
  }

  /** Removes a conversation and returns whichever should be shown next. */
  async remove(sessionId: string): Promise<ChatSession | null> {
    const remaining = this.list().filter((session) => session.id !== sessionId);
    await this.write(remaining);

    if (remaining.length === 0) return this.create();

    const next = remaining[0]!;
    await this.setActive(next.id);
    return next;
  }

  private async write(sessions: ChatSession[]): Promise<void> {
    const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    await this.memento.update(SESSIONS_KEY, ordered.slice(0, MAX_SESSIONS));
    // The legacy list has been folded into a session by now; leaving it behind
    // would resurrect it as a duplicate on the next read.
    if (this.memento.get(LEGACY_TURNS_KEY) !== undefined) {
      await this.memento.update(LEGACY_TURNS_KEY, undefined);
    }
  }
}
