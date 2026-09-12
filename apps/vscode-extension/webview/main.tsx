import { StrictMode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SponsoredAd } from '@aam/shared';
import type { HostState, PersistedTurn, ToolActivity } from '../src/protocol';
import { AdCard } from './AdCard';
import { InlineAd } from './InlineAd';
import { CopyButton, IconButton } from './IconButton';
import { InsertIcon, RegenerateIcon } from './icons';
import { Markdown } from './markdown';
import { ToolTrail } from './ToolTrail';
import { ModelMenu } from './ModelMenu';
import { SessionMenu } from './SessionMenu';
import { STYLES } from './styles';

/**
 * Chat UI.
 *
 * The turn is the unit: a question, the streaming answer, and — as siblings of
 * the answer, never inside it — the sponsored slot. Modelling it this way makes
 * it structurally impossible to render an ad as if the assistant wrote it.
 *
 * A turn shows *one* ad at a time, never both. While the answer is still being
 * produced the inline line sits above it, in the space the developer is already
 * waiting in; once the answer is finished that line is retired and the banner
 * card takes over below it. Two sponsored things competing for attention in a
 * single turn is one too many, and the two formats were designed for different
 * moments anyway — the line for dead time, the card for a developer who has
 * finished reading.
 */

/** Openers that actually reach a campaign, so the first try is never a dead end. */
const SUGGESTIONS = [
  'How do I deploy a Solidity contract with Foundry?',
  'How do I run containers in production with Docker?',
  'How do I fuzz test my Solidity invariants?',
];

interface Turn extends PersistedTurn {
  error: string | null;
  streaming: boolean;
  /**
   * Loaded from a saved conversation rather than produced in this session.
   *
   * Its sponsored slots were already acknowledged when they were first shown,
   * so they must not be acknowledged again on reopen. Runtime only — stripped
   * before the turn is written back.
   */
  restored: boolean;
}

declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void };
const vscode = acquireVsCodeApi();

const newTurnId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function emptyTurn(id: string, question: string): Turn {
  return {
    id,
    question,
    answer: '',
    tools: [],
    ad: null,
    inlineAd: null,
    rewardMicro: null,
    usage: null,
    model: null,
    error: null,
    streaming: true,
    restored: false,
  };
}

/** Fills in fields a conversation saved by an older version will not have. */
function hydrate(turn: PersistedTurn): Turn {
  return {
    ...turn,
    tools: turn.tools ?? [],
    inlineAd: turn.inlineAd ?? null,
    model: turn.model ?? null,
    error: null,
    streaming: false,
    restored: true,
  };
}

function formatCredits(micro: number | string): string {
  return `$${(Number(micro) / 1_000_000).toFixed(4)}`;
}

/**
 * A finished or streaming answer.
 *
 * Memoised on the text alone: without this, every delta of the current answer
 * re-parses the markdown of every earlier answer in the conversation, and a
 * long session gets visibly slower as it goes on.
 */
const Answer = memo(function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  const body = useMemo(
    () => (
      <Markdown
        text={text}
        onCopyCode={(code) => vscode.postMessage({ type: 'copy', text: code })}
        onInsertCode={(code) => vscode.postMessage({ type: 'insertCode', code })}
      />
    ),
    [text],
  );

  if (!text) {
    return streaming ? <div className="thinking">Thinking</div> : null;
  }

  return (
    <div className="answer">
      {body}
      {streaming && <span className="caret" />}
    </div>
  );
});

function App() {
  const [state, setState] = useState<HostState>({
    signedIn: false,
    creditBalanceMicro: null,
    hasSelection: false,
    includeSelection: true,
    models: [],
    selectedModel: null,
    sessions: [],
    activeSessionId: null,
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /**
   * The conversation currently on screen.
   *
   * Tracked in a ref as well as in state because the persist effect below has
   * to know which conversation the turns it is about to write belong to. Without
   * it, switching sessions mid-write saves one conversation's turns over
   * another's.
   */
  const sessionId = useRef<string | null>(null);

  // Deltas arrive far faster than the screen refreshes. Buffering them and
  // applying one batch per frame keeps a long answer from re-rendering the
  // whole conversation hundreds of times while it streams.
  const buffered = useRef(new Map<string, string>());
  const frame = useRef<number | null>(null);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const flushDeltas = useCallback(() => {
    frame.current = null;
    const batch = buffered.current;
    if (batch.size === 0) return;
    buffered.current = new Map();

    setTurns((current) =>
      current.map((t) => {
        const chunk = batch.get(t.id);
        return chunk ? { ...t, answer: t.answer + chunk } : t;
      }),
    );
  }, []);

  const queueDelta = useCallback(
    (id: string, text: string) => {
      buffered.current.set(id, (buffered.current.get(id) ?? '') + text);
      frame.current ??= requestAnimationFrame(flushDeltas);
    },
    [flushDeltas],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'state':
          setState(message.state);
          break;
        case 'restore':
          // A restore replaces the panel wholesale, so anything buffered for the
          // conversation being left must not land in the one being opened.
          buffered.current = new Map();
          sessionId.current = message.sessionId;
          setTurns((message.turns as PersistedTurn[]).map(hydrate));
          break;
        case 'delta':
          queueDelta(message.id, message.text);
          break;
        case 'ad':
          // One event for both slots; the card says which one it belongs in.
          patchTurn(
            message.id,
            (message.ad as SponsoredAd).format === 'inline'
              ? { inlineAd: message.ad }
              : { ad: message.ad },
          );
          break;
        case 'tool':
          // Keyed by tool-use id so a call updates in place as it runs, needs a
          // decision, and finishes — rather than stacking up as three lines.
          setTurns((current) =>
            current.map((t) => {
              if (t.id !== message.id) return t;
              const activity = message.activity as ToolActivity;
              const existing = t.tools.findIndex((a) => a.id === activity.id);
              const tools =
                existing === -1
                  ? [...t.tools, activity]
                  : t.tools.map((a, i) => (i === existing ? activity : a));
              return { ...t, tools };
            }),
          );
          break;
        case 'usage':
          patchTurn(message.id, {
            usage: { totalTokens: message.totalTokens, costMicro: message.costMicro },
            model: message.model,
          });
          break;
        case 'reward':
          patchTurn(message.id, { rewardMicro: message.amountMicro });
          setNotice(`+${formatCredits(message.amountMicro)} credits earned`);
          break;
        case 'done':
          // Any buffered tail must land before the turn stops streaming.
          flushDeltas();
          patchTurn(message.id, { streaming: false });
          break;
        case 'error':
          flushDeltas();
          patchTurn(message.id, { error: message.message, streaming: false });
          break;
        case 'notice':
          setNotice(message.text);
          break;
      }
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [patchTurn, queueDelta, flushDeltas]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  // Follow the answer only while the developer is already at the bottom. Yanking
  // the view back while they are reading something further up is worse than not
  // following at all.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [turns]);

  // Conversations survive a restart, so they have to be written down.
  useEffect(() => {
    if (turns.length === 0) return;
    const owner = sessionId.current;
    const timer = setTimeout(() => {
      // The conversation moved on while the write was pending; these turns are
      // no longer the ones on screen and must not overwrite the new session.
      if (sessionId.current !== owner) return;
      vscode.postMessage({
        type: 'persist',
        turns: turns.map(
          ({ error: _error, streaming: _streaming, restored: _restored, ...rest }) => rest,
        ),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [turns]);

  const ask = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const id = newTurnId();
    pinnedToBottom.current = true;
    setTurns((current) => [...current, emptyTurn(id, trimmed)]);
    setDraft('');
    vscode.postMessage({ type: 'send', id, text: trimmed });
  }, []);

  /** Replaces the last turn in place, so the discarded answer does not linger. */
  const regenerate = (turn: Turn) => {
    const id = newTurnId();
    setTurns((current) => [...current.slice(0, -1), emptyTurn(id, turn.question)]);
    vscode.postMessage({ type: 'send', id, text: turn.question, replaceLast: true });
  };

  const streaming = turns.some((t) => t.streaming);

  if (!state.signedIn) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="signed-out">
          <div className="brand-dot large" />
          <h2>Ads that pay for your AI.</h2>
          <p>
            Ask about the code you are working on. A relevant sponsored card appears beside the
            answer — never inside it — and the credits it earns pay for your next question.
          </p>
          <button className="primary" onClick={() => vscode.postMessage({ type: 'signIn' })}>
            Sign in
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>

      <header className="topbar">
        <SessionMenu
          sessions={state.sessions}
          activeId={state.activeSessionId}
          onSwitch={(id) => vscode.postMessage({ type: 'switchSession', sessionId: id })}
          onCreate={() => vscode.postMessage({ type: 'newSession' })}
          onRename={(id, title) =>
            vscode.postMessage({ type: 'renameSession', sessionId: id, title })
          }
          onDelete={(id) => vscode.postMessage({ type: 'deleteSession', sessionId: id })}
        />

        <span className="topbar-actions">
          {state.creditBalanceMicro !== null && (
            <button
              className="credits"
              title="Open your dashboard"
              onClick={() => vscode.postMessage({ type: 'openDashboard' })}
            >
              {formatCredits(state.creditBalanceMicro)}
            </button>
          )}
          <button
            className="ghost icon"
            title="New chat"
            aria-label="New chat"
            onClick={() => vscode.postMessage({ type: 'newSession' })}
          >
            ＋
          </button>
        </span>
      </header>

      <div
        className="messages"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {turns.length === 0 && (
          <div className="empty">
            <p className="empty-title">Ask anything about your code.</p>
            {state.hasSelection && state.includeSelection && (
              <p className="empty-note">Your editor selection will be included.</p>
            )}
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} className="suggestion" onClick={() => ask(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => {
          /**
           * One slot at a time.
           *
           * While the turn is working — thinking, or streaming — the inline
           * line is the sponsored slot; the card is held back even if the
           * banner auction has already resolved. Once the answer is done the
           * line is retired and the card takes its place.
           *
           * The exception is a turn that won no banner at all: pulling the
           * line away then would leave the finished answer with nothing where
           * an ad had just been, which reads as a glitch rather than as a
           * handover. Either way, only ever one of the two is on screen.
           */
          const working = turn.streaming;
          const showInlineAd = Boolean(turn.inlineAd) && (working || !turn.ad);
          const showBannerAd = Boolean(turn.ad) && !working;

          return (
            <div className="turn" key={turn.id}>
              <div className="question">
                <div className="question-bubble">{turn.question}</div>
              </div>

              {/* Above the answer, where the waiting is. A sibling of it, never
                  inside it — and only while the turn is still working, so it is
                  never on screen at the same time as the card below. */}
              {showInlineAd && (
                <InlineAd
                  ad={turn.inlineAd as SponsoredAd}
                  alreadyAcknowledged={turn.restored}
                  onVisible={(impressionId, visibleMs) =>
                    vscode.postMessage({ type: 'adVisible', id: turn.id, impressionId, visibleMs })
                  }
                  onClick={(impressionId, url) =>
                    vscode.postMessage({ type: 'adClick', id: turn.id, impressionId, url })
                  }
                  onDismiss={(impressionId) => {
                    vscode.postMessage({ type: 'adDismiss', impressionId });
                    patchTurn(turn.id, { inlineAd: null });
                  }}
                />
              )}

              <ToolTrail
                activities={turn.tools}
                onApprove={(toolUseId) => vscode.postMessage({ type: 'approveWrite', toolUseId })}
                onReject={(toolUseId) => vscode.postMessage({ type: 'rejectWrite', toolUseId })}
                onReview={(toolUseId) => vscode.postMessage({ type: 'reviewWrite', toolUseId })}
              />

              <Answer text={turn.answer} streaming={turn.streaming} />

              {turn.error && <div className="error">{turn.error}</div>}

              {!turn.streaming && turn.answer && (
                <div className="answer-actions">
                  <CopyButton
                    label="Copy answer"
                    onCopy={() => vscode.postMessage({ type: 'copy', text: turn.answer })}
                  />
                  <IconButton
                    label="Insert answer at cursor"
                    onClick={() => vscode.postMessage({ type: 'insertCode', code: turn.answer })}
                  >
                    <InsertIcon />
                  </IconButton>
                  {index === turns.length - 1 && (
                    <IconButton label="Regenerate answer" onClick={() => regenerate(turn)}>
                      <RegenerateIcon />
                    </IconButton>
                  )}
                  {/* What the answer cost, next to what the card earns: the whole
                      product argument, stated in the two numbers themselves. */}
                  {turn.usage && (
                    <span className="answer-cost">
                      {turn.usage.totalTokens.toLocaleString()} tokens ·{' '}
                      {formatCredits(turn.usage.costMicro)}
                    </span>
                  )}
                </div>
              )}

              {/* A sibling of the answer, never inside it. It takes over from
                  the inline line once the answer is finished. */}
              {showBannerAd && (
                <AdCard
                  ad={turn.ad as SponsoredAd}
                  rewardMicro={turn.rewardMicro}
                  alreadyAcknowledged={turn.restored}
                  onVisible={(impressionId, visibleMs) =>
                    vscode.postMessage({ type: 'adVisible', id: turn.id, impressionId, visibleMs })
                  }
                  onClick={(impressionId, url) =>
                    vscode.postMessage({ type: 'adClick', id: turn.id, impressionId, url })
                  }
                  onDismiss={(impressionId) => {
                    vscode.postMessage({ type: 'adDismiss', impressionId });
                    patchTurn(turn.id, { ad: null });
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {notice && <div className="toast">{notice}</div>}

      <div className="composer">
        {state.hasSelection && state.includeSelection && (
          <div className="selection-chip">Editor selection included</div>
        )}
        <div className="composer-box">
          <textarea
            ref={composerRef}
            value={draft}
            rows={2}
            placeholder="Ask about your code..."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                ask(draft);
              }
            }}
          />
          <div className="composer-bar">
            <ModelMenu
              models={state.models}
              selectedId={state.selectedModel}
              disabled={streaming}
              onSelect={(modelId) => vscode.postMessage({ type: 'selectModel', modelId })}
            />
            {streaming ? (
              <button className="stop" onClick={() => vscode.postMessage({ type: 'cancel' })}>
                Stop
              </button>
            ) : (
              <button className="primary send" onClick={() => ask(draft)} disabled={!draft.trim()}>
                Send
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">Enter to send · Shift + Enter for a new line</div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
