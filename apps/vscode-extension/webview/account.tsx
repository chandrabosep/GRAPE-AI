import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AccountHostToWebview,
  AccountState,
  AccountWebviewToHost,
  SessionSummary,
} from '../src/protocol';
import { ACCOUNT_STYLES } from './account-styles';

/**
 * Account & sessions panel.
 *
 * Deliberately a reference surface, not a dashboard: every figure here is one
 * the developer might want mid-task — what they have, what they have earned,
 * what today cost — and nothing here is a chart.
 *
 * The one progress bar is earnings against the withdrawal threshold, because
 * that is the only quantity in this product with a real ceiling. A bar needs an
 * end to mean anything, and a credit balance does not have one; inventing a
 * "daily limit" to fill would have been a bar that cannot actually stop you.
 */

interface VsCodeApi {
  postMessage(message: AccountWebviewToHost): void;
  getState(): { collapsed?: Record<string, boolean> } | undefined;
  setState(state: { collapsed?: Record<string, boolean> }): void;
}

declare const acquireVsCodeApi: () => VsCodeApi;
const vscode = acquireVsCodeApi();

const EMPTY: AccountState = {
  signedIn: false,
  offline: false,
  email: null,
  displayName: null,
  creditBalanceMicro: null,
  withdrawableMicro: null,
  minPayoutMicro: null,
  todayTokens: null,
  todayCostMicro: null,
  requestsToday: null,
  sessions: [],
  activeSessionId: null,
};

/** Micro-dollars to a displayable amount. */
function money(micro: string | number | null, digits = 4): string | null {
  if (micro === null) return null;
  const value = Number(micro);
  if (!Number.isFinite(value)) return null;
  return `$${(value / 1_000_000).toFixed(digits)}`;
}

/**
 * Today, as one line.
 *
 * Parts that are not known are dropped rather than rendered as a dash, so the
 * line stays readable while the first fetch is still in flight.
 */
function todayLine(state: AccountState): string {
  const parts = [
    state.todayTokens === null ? null : `${state.todayTokens.toLocaleString()} tok`,
    money(state.todayCostMicro, 4),
    state.requestsToday === null
      ? null
      : `${state.requestsToday} ${state.requestsToday === 1 ? 'request' : 'requests'}`,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** "3m", "2h", "4d" — a sidebar has no room for a date. */
function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`chevron${collapsed ? ' collapsed' : ''}`}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** A collapsible section. Collapsed state survives a reload via webview state. */
function Section({
  id,
  title,
  action,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  action?: { label: string; onClick: () => void };
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="section">
      <button
        className="section-header"
        onClick={() => onToggle(id)}
        aria-expanded={!collapsed}
      >
        <Chevron collapsed={collapsed} />
        <span className="section-title">{title}</span>
        {action && (
          <span
            className="section-action"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              // The header toggles; this must not.
              event.stopPropagation();
              action.onClick();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.stopPropagation();
              event.preventDefault();
              action.onClick();
            }}
          >
            {action.label}
          </span>
        )}
      </button>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  );
}

/**
 * Earnings against the payout threshold.
 *
 * Hidden entirely rather than shown empty when the threshold is unknown: a bar
 * with no denominator is decoration.
 */
function EarningsMeter({
  withdrawableMicro,
  minPayoutMicro,
  onWithdraw,
}: {
  withdrawableMicro: string | null;
  minPayoutMicro: number | null;
  onWithdraw: () => void;
}) {
  if (withdrawableMicro === null || minPayoutMicro === null || minPayoutMicro <= 0) return null;

  const earned = Number(withdrawableMicro);
  if (!Number.isFinite(earned)) return null;

  const ratio = Math.max(0, Math.min(1, earned / minPayoutMicro));
  const ready = earned >= minPayoutMicro;
  const remaining = Math.max(0, minPayoutMicro - earned);

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-name">Earnings</span>
        <span className="meter-figure">
          {money(earned, 2)} / {money(minPayoutMicro, 2)}
        </span>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Earnings toward payout threshold"
      >
        <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {ready ? (
        <button className="meter-cta" onClick={onWithdraw}>
          Ready to withdraw →
        </button>
      ) : (
        <div className="meter-note">{money(remaining, 4)} more to withdraw</div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  active,
  onSwitch,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onSwitch: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) onRename(session.id, trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`session${active ? ' active' : ''}`}>
        <span className={`session-dot${active ? '' : ' hidden'}`} />
        <input
          ref={input}
          className="session-rename"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(session.title);
              setEditing(false);
            }
          }}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      className={`session${active ? ' active' : ''}`}
      onClick={() => onSwitch(session.id)}
      role="button"
      tabIndex={0}
      title={`${session.title} · ${session.turnCount} ${
        session.turnCount === 1 ? 'message' : 'messages'
      }`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSwitch(session.id);
        }
      }}
    >
      <span className={`session-dot${active ? '' : ' hidden'}`} />
      <span className="session-name">{session.title}</span>
      <span className="session-age">{ago(session.updatedAt)}</span>
      <span className="session-actions">
        <button
          className="session-action"
          title="Rename"
          onClick={(event) => {
            event.stopPropagation();
            setDraft(session.title);
            setEditing(true);
          }}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              d="M11.5 1.5l3 3-8 8H3.5v-3l8-8z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </button>
        <button
          className="session-action"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(session.id);
          }}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </span>
    </div>
  );
}

function App() {
  const [state, setState] = useState<AccountState>(EMPTY);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => vscode.getState()?.collapsed ?? {},
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<AccountHostToWebview>) => {
      if (event.data.type === 'account') setState(event.data.state);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      vscode.setState({ collapsed: next });
      return next;
    });
  }, []);

  const post = useCallback((message: AccountWebviewToHost) => vscode.postMessage(message), []);

  return (
    <>
      <style>{ACCOUNT_STYLES}</style>

      <Section
        id="account"
        title="Account"
        action={
          state.signedIn
            ? { label: 'View details', onClick: () => post({ type: 'openDashboard' }) }
            : undefined
        }
        collapsed={collapsed.account ?? false}
        onToggle={toggle}
      >
        {!state.signedIn ? (
          <>
            <div className="empty">Sign in to see your balance and earnings.</div>
            <button className="signin" onClick={() => post({ type: 'signIn' })}>
              Sign in
            </button>
          </>
        ) : (
          <>
            {/* The identity needs no label — an address or an email is
                self-evidently one, and "Account: Account" was the panel telling
                you twice what it was already showing. */}
            <div className="identity" title={state.email ?? state.displayName ?? undefined}>
              {state.email ?? state.displayName ?? '—'}
            </div>

            {/* The balance is the number a developer opens this for: it is what
                lets them keep asking questions. It gets the size, and the word
                "balance" shrinks to a caption instead of owning a whole row. */}
            <div className="hero">
              <span className="hero-value">{money(state.creditBalanceMicro, 4) ?? '—'}</span>
              <span className="hero-caption">balance</span>
            </div>

            <EarningsMeter
              withdrawableMicro={state.withdrawableMicro}
              minPayoutMicro={state.minPayoutMicro}
              onWithdraw={() => post({ type: 'withdraw' })}
            />

            {/* Three facts about the same thing — today — on one line. As three
                labelled rows they read as three unrelated metrics and cost three
                times the space to say it. */}
            <div className="today">
              <span className="today-label">Today</span>
              <span className="today-value">{todayLine(state)}</span>
            </div>

            {state.offline && (
              <div className="stale">
                Couldn't reach the marketplace — showing the last known figures.
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        id="sessions"
        title="Session Manager"
        action={{ label: '+ New session', onClick: () => post({ type: 'newSession' }) }}
        collapsed={collapsed.sessions ?? false}
        onToggle={toggle}
      >
        {state.sessions.length === 0 ? (
          <div className="empty">No conversations yet.</div>
        ) : (
          <div className="session-list">
            {state.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === state.activeSessionId}
                onSwitch={(sessionId) => post({ type: 'switchSession', sessionId })}
                onRename={(sessionId, title) => post({ type: 'renameSession', sessionId, title })}
                onDelete={(sessionId) => post({ type: 'deleteSession', sessionId })}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
