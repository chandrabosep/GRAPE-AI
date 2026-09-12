import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PersistedTurn } from './protocol';
import { SessionCoordinator } from './session-coordinator';

/**
 * The coordinator exists so two views cannot drift apart, and the only thing
 * that guarantees that is the change event. So these tests assert that every
 * write announces itself — including `saveTurns`, which is easy to miss because
 * nothing was opened or closed, yet it is what names an untitled conversation
 * and reorders the list.
 *
 * `SessionStore` takes a `vscode.Memento` as a type, not an import, so a plain
 * object is enough and no editor mock is involved.
 */

/** An in-memory Memento. */
function memento() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T): T | undefined =>
      (values.has(key) ? (values.get(key) as T) : fallback),
    update: (key: string, value: unknown): Thenable<void> => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
      return Promise.resolve() as unknown as Thenable<void>;
    },
    keys: () => [...values.keys()],
  };
}

function turn(question: string): PersistedTurn {
  return {
    id: question,
    question,
    answer: 'answer',
    tools: [],
    ad: null,
    inlineAd: null,
    rewardMicro: null,
    usage: null,
    model: null,
  };
}

describe('SessionCoordinator', () => {
  let coordinator: SessionCoordinator;
  let changes: Mock<() => void>;

  beforeEach(() => {
    coordinator = new SessionCoordinator(memento() as never);
    changes = vi.fn<() => void>();
    coordinator.onDidChange(changes);
  });

  it('announces a created conversation and makes it active', async () => {
    const session = await coordinator.create();

    expect(changes).toHaveBeenCalledTimes(1);
    expect(coordinator.activeId()).toBe(session.id);
  });

  it('announces a switch and reports the new active id', async () => {
    const first = await coordinator.create();
    const second = await coordinator.create();
    changes.mockClear();

    await coordinator.setActive(first.id);

    expect(changes).toHaveBeenCalledTimes(1);
    expect(coordinator.activeId()).toBe(first.id);
    expect(coordinator.activeId()).not.toBe(second.id);
  });

  it('announces a rename and reflects the new title', async () => {
    const session = await coordinator.create();
    changes.mockClear();

    await coordinator.rename(session.id, 'Graph protocol verification');

    expect(changes).toHaveBeenCalledTimes(1);
    expect(coordinator.get(session.id)?.title).toBe('Graph protocol verification');
  });

  it('announces saved turns, because they retitle and reorder the list', async () => {
    const session = await coordinator.create();
    changes.mockClear();

    await coordinator.saveTurns(session.id, [turn('how much does vitalik.eth hold')]);

    expect(changes).toHaveBeenCalledTimes(1);
    expect(coordinator.summaries()[0]?.title).toBe('how much does vitalik.eth hold');
    expect(coordinator.summaries()[0]?.turnCount).toBe(1);
  });

  it('promotes another conversation when the active one is deleted', async () => {
    const keep = await coordinator.create();
    const doomed = await coordinator.create();
    expect(coordinator.activeId()).toBe(doomed.id);
    changes.mockClear();

    const next = await coordinator.remove(doomed.id);

    expect(changes).toHaveBeenCalledTimes(1);
    expect(next?.id).toBe(keep.id);
    expect(coordinator.activeId()).toBe(keep.id);
    expect(coordinator.get(doomed.id)).toBeNull();
  });

  it('never leaves the panel with nothing to show', async () => {
    const only = await coordinator.create();

    const next = await coordinator.remove(only.id);

    // Deleting the last conversation creates a fresh one rather than emptying
    // the panel, which is what the chat's "where I left off" promise needs.
    expect(next).not.toBeNull();
    expect(next?.id).not.toBe(only.id);
    expect(coordinator.summaries()).toHaveLength(1);
  });

  it('stops telling a disposed listener', async () => {
    const subscription = coordinator.onDidChange(changes);
    subscription.dispose();

    await coordinator.create();

    // Still one call: the listener registered in beforeEach. The second
    // registration of the same function was disposed.
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('tells every listener even when one throws', async () => {
    const after = vi.fn<() => void>();
    coordinator.onDidChange(() => {
      throw new Error('render failed');
    });
    coordinator.onDidChange(after);

    await expect(coordinator.create()).resolves.toBeDefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('falls back to a real conversation when the stored active id is gone', async () => {
    const first = await coordinator.create();
    await coordinator.setActive('a-conversation-that-was-deleted');

    // `activeId` resolves through the store, so a dangling id does not leave
    // the panel with nothing highlighted.
    expect(coordinator.activeId()).toBe(first.id);
  });
});
