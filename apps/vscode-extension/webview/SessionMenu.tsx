import { useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '../src/protocol';

/**
 * The conversation switcher.
 *
 * A dropdown rather than a permanent list: the sidebar is narrow, and a
 * standing list of conversations would take room from the thing the developer
 * actually came to read. The active conversation's name stays visible in the
 * bar so it is always clear which one is open.
 */

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSwitch: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}

/** "3m", "2h", "4d" — a sidebar has no room for a date. */
function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function SessionMenu({
  sessions,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const active = sessions.find((session) => session.id === activeId);

  const commitRename = (sessionId: string) => {
    const trimmed = draft.trim();
    if (trimmed) onRename(sessionId, trimmed);
    setEditingId(null);
  };

  return (
    <div className="session-menu" ref={ref}>
      <button
        className="session-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        title="Switch conversation"
      >
        <span className="session-trigger-title">{active?.title ?? 'New chat'}</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="session-dropdown" role="menu">
          <button
            className="session-new"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            + New chat
          </button>

          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-row${session.id === activeId ? ' active' : ''}`}
              >
                {editingId === session.id ? (
                  <input
                    className="session-rename"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(session.id);
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      className="session-open"
                      onClick={() => {
                        onSwitch(session.id);
                        setOpen(false);
                      }}
                      title={session.title}
                    >
                      <span className="session-title">{session.title}</span>
                      <span className="session-meta">
                        {session.turnCount > 0 && `${session.turnCount} · `}
                        {ago(session.updatedAt)}
                      </span>
                    </button>

                    <button
                      className="session-action"
                      aria-label={`Rename ${session.title}`}
                      onClick={() => {
                        setDraft(session.title);
                        setEditingId(session.id);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="session-action"
                      aria-label={`Delete ${session.title}`}
                      onClick={() => onDelete(session.id)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}

            {sessions.length === 0 && <div className="session-empty">No conversations yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
