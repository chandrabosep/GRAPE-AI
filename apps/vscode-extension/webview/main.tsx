import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SponsoredAd } from '@aam/shared';
import { AdCard } from './AdCard';
import { STYLES } from './styles';

/**
 * Chat UI.
 *
 * The turn is the unit: a question, the streaming answer, and — as a sibling of
 * the answer, never inside it — the sponsored card. Modelling it this way makes
 * it structurally impossible to render an ad as if the assistant wrote it.
 */

interface HostState {
  signedIn: boolean;
  creditBalanceMicro: string | null;
  hasSelection: boolean;
  includeSelection: boolean;
}

interface Turn {
  id: string;
  question: string;
  answer: string;
  ad: SponsoredAd | null;
  rewardMicro: number | null;
  error: string | null;
  streaming: boolean;
}

declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void };
const vscode = acquireVsCodeApi();

function App() {
  const [state, setState] = useState<HostState>({
    signedIn: false,
    creditBalanceMicro: null,
    hasSelection: false,
    includeSelection: true,
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'state':
          setState(message.state);
          break;
        case 'delta':
          setTurns((current) =>
            current.map((t) => (t.id === message.id ? { ...t, answer: t.answer + message.text } : t)),
          );
          break;
        case 'ad':
          patchTurn(message.id, { ad: message.ad });
          break;
        case 'reward':
          patchTurn(message.id, { rewardMicro: message.amountMicro });
          break;
        case 'done':
          patchTurn(message.id, { streaming: false });
          break;
        case 'error':
          patchTurn(message.id, { error: message.message, streaming: false });
          break;
      }
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [patchTurn]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTurns((current) => [
      ...current,
      { id, question: text, answer: '', ad: null, rewardMicro: null, error: null, streaming: true },
    ]);
    setDraft('');
    vscode.postMessage({ type: 'send', id, text });
  };

  const streaming = turns.some((t) => t.streaming);

  if (!state.signedIn) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="empty">
          <p>
            <strong>Ads that pay for your AI.</strong>
          </p>
          <p>
            Ask questions about your code. A relevant sponsored card appears alongside the
            answer, and the credits it earns pay for your next question.
          </p>
          <button onClick={() => vscode.postMessage({ type: 'signIn' })}>Sign in</button>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>

      <div className="messages">
        {turns.length === 0 && (
          <div className="empty">
            Ask anything about the code you are working on.
            {state.hasSelection && state.includeSelection && (
              <div style={{ marginTop: 8 }}>Your current selection will be included.</div>
            )}
          </div>
        )}

        {turns.map((turn) => (
          <div className="turn" key={turn.id}>
            <div className="role">You</div>
            <div className="bubble">{turn.question}</div>

            <div className="role" style={{ marginTop: 8 }}>
              Assistant
            </div>
            <div className="bubble">
              {turn.answer}
              {turn.streaming && !turn.answer && <span>…</span>}
            </div>

            {turn.error && <div className="error">{turn.error}</div>}

            {/* A sibling of the answer, never inside it. */}
            {turn.ad && (
              <AdCard
                ad={turn.ad}
                rewardMicro={turn.rewardMicro}
                onVisible={(impressionId, visibleMs) =>
                  vscode.postMessage({ type: 'adVisible', impressionId, visibleMs })
                }
                onClick={(impressionId, url) =>
                  vscode.postMessage({ type: 'adClick', impressionId, url })
                }
                onDismiss={(impressionId) => vscode.postMessage({ type: 'adDismiss', impressionId })}
              />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={draft}
          placeholder="Ask about your code..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="footer">
          <span>
            {state.creditBalanceMicro !== null
              ? `$${(Number(state.creditBalanceMicro) / 1_000_000).toFixed(4)} credits`
              : ''}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {streaming ? (
              <button className="link" onClick={() => vscode.postMessage({ type: 'cancel' })}>
                Stop
              </button>
            ) : (
              <button onClick={send} disabled={!draft.trim()}>
                Send
              </button>
            )}
          </span>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
