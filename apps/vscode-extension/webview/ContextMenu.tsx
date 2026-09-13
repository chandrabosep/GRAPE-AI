import { useEffect, useRef, useState } from 'react';
import { CheckIcon, PlusIcon } from './icons';

/**
 * The composer's `+`.
 *
 * Every assistant has one, and in most of them it means "add something to this
 * message". Here the only thing there is to add is the editor selection, so
 * that is what it offers — a real switch over `grapeAi.includeSelection`, the
 * same setting the preferences pane writes. A menu of things that only look
 * like features would cost more trust than the affordance buys.
 *
 * "New chat" sits under it because the alternative is a developer scrolling to
 * find the session switcher when what they wanted was a blank page.
 */

interface Props {
  /** False when the editor has no selection, which makes the toggle inert. */
  hasSelection: boolean;
  includeSelection: boolean;
  onToggleSelection: (value: boolean) => void;
  onNewChat: () => void;
  disabled?: boolean;
}

export function ContextMenu({
  hasSelection,
  includeSelection,
  onToggleSelection,
  onNewChat,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes it, including elsewhere in the chat.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="composer-context" ref={root}>
      <button
        className="ghost composer-plus"
        title="Add context"
        aria-label="Add context"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <PlusIcon />
      </button>

      {open && (
        <div className="composer-menu" role="menu">
          <button
            role="menuitemcheckbox"
            aria-checked={includeSelection && hasSelection}
            // Disabled rather than hidden: the developer needs to know the
            // option exists and why it is not available right now.
            disabled={!hasSelection}
            title={
              hasSelection
                ? 'Send the highlighted code with your question'
                : 'Highlight code in the editor to attach it'
            }
            onClick={() => {
              onToggleSelection(!includeSelection);
              setOpen(false);
            }}
          >
            <span className="composer-menu-check">
              {includeSelection && hasSelection ? <CheckIcon /> : null}
            </span>
            <span>Include editor selection</span>
          </button>

          <div className="composer-menu-rule" />

          <button
            role="menuitem"
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
          >
            <span className="composer-menu-check" />
            <span>New chat</span>
          </button>
        </div>
      )}
    </div>
  );
}
