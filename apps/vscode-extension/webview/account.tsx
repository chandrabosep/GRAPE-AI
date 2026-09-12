import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * Shaped like the editor's own side panels rather than like a dashboard: named
 * groups of rows, each row a thing and its current value, with a meter only
 * where a value has a ceiling it can actually reach. Read in glances, down a
 * single right-hand column, so nothing here is a chart and nothing is a card.
 *
 * The one meter is earnings against the withdrawal threshold, because that is
 * the only quantity in this product with a real ceiling. A bar needs an end to
 * mean anything, and a credit balance does not have one; inventing a "daily
 * limit" to fill would have been a bar that cannot actually stop you.
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

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.6 7.6L10.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** A collapsible group of rows. Collapsed state survives a reload via webview state. */
function Section({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
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
      </button>
      {!collapsed && children}
    </div>
  );
}

/** A name and its current value, sharing the panel's right edge. */
function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={`row-value${strong ? ' strong' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * Earnings against the payout threshold.
 *
 * Hidden entirely rather than shown empty when the threshold is unknown: a bar
 * with no denominator is decoration. The percentage sits where every other
 * figure sits, and what the empty part of the bar costs you is the caption.
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
        <span className="meter-figure">{Math.round(ratio * 100)}%</span>
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
        <div className="meter-note">
          {money(earned, 2)} of {money(minPayoutMicro, 2)} · {money(remaining, 4)} to go
        </div>
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
            <path
              d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </button>
      </span>
    </div>
  );
}

function App() {
  const [state, setState] = useState<AccountState>(EMPTY);
  const [query, setQuery] = useState('');
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

  // Filtering a list of a dozen titles is cheaper than the round trip it would
  // take to ask the host, so the field is answered here.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.sessions;
    return state.sessions.filter((session) => session.title.toLowerCase().includes(needle));
  }, [state.sessions, query]);

  return (
    <>
      <style>{ACCOUNT_STYLES}</style>

      <Section
        id="account"
        title="Account"
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
            <Row label="Email" value={state.email ?? state.displayName ?? '—'} />
            <Row label="Balance" value={money(state.creditBalanceMicro, 4) ?? '—'} strong />
            <Row label="Earned" value={money(state.withdrawableMicro, 4) ?? '—'} />

            <div className="links">
              <button className="link" onClick={() => post({ type: 'topUp' })}>
                Top up
              </button>
              <button className="link" onClick={() => post({ type: 'openDashboard' })}>
                Dashboard
              </button>
            </div>

            {state.offline && (
              <div className="stale">
                Couldn't reach the marketplace — showing the last known figures.
              </div>
            )}
          </>
        )}
      </Section>

      {state.signedIn && (
        <Section
          id="usage"
          title="Usage"
          collapsed={collapsed.usage ?? false}
          onToggle={toggle}
        >
          <EarningsMeter
            withdrawableMicro={state.withdrawableMicro}
            minPayoutMicro={state.minPayoutMicro}
            onWithdraw={() => post({ type: 'withdraw' })}
          />

          {/* Three facts about the same window — today — so the window is said
              once, in the caption under them, rather than three times over in
              the labels. */}
          <Row
            label="Tokens"
            value={state.todayTokens === null ? '—' : state.todayTokens.toLocaleString()}
          />
          <Row label="Spend" value={money(state.todayCostMicro, 4) ?? '—'} />
          <Row
            label="Requests"
            value={state.requestsToday === null ? '—' : String(state.requestsToday)}
          />
          <div className="empty">Today · resets at midnight</div>
        </Section>
      )}

      <Section
        id="sessions"
        title="Session Manager"
        collapsed={collapsed.sessions ?? false}
        onToggle={toggle}
      >
        <button className="command" onClick={() => post({ type: 'newSession' })}>
          <PlusIcon />
          New session
        </button>

        {/* The field only earns its row once the list is long enough to lose
            something in. */}
        {state.sessions.length > 5 && (
          <div className="toolbar">
            <label className="search">
              <SearchIcon />
              <input
                type="search"
                value={query}
                placeholder="Filter conversations"
                aria-label="Filter conversations"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className="count">
              {query.trim() ? `${visible.length}/${state.sessions.length}` : state.sessions.length}
            </span>
          </div>
        )}

        {state.sessions.length === 0 ? (
          <div className="empty">No conversations yet.</div>
        ) : visible.length === 0 ? (
          <div className="empty">Nothing matches "{query.trim()}".</div>
        ) : (
          <div className="session-list">
            {visible.map((session) => (
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
