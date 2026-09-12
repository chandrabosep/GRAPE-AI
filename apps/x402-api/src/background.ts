/**
 * Keeping post-response work alive on a serverless host.
 *
 * The payment row is written from `res.on('finish')`, because the Hedera
 * transaction id only exists once the x402 middleware has settled and flushed
 * the response. Under `node main.ts` that is free — the process is still there.
 * On Vercel the invocation is frozen the moment the response completes, and a
 * promise started after that point is simply dropped, so the payment settles
 * onchain and leaves no local row.
 *
 * Vercel exposes an escape hatch for exactly this: a per-invocation context
 * carrying `waitUntil`. It is read here off the documented global symbol rather
 * than through `@vercel/functions` so the service keeps running unchanged
 * anywhere else — off-platform the lookup misses and the promise is left to
 * run on its own, which is the behaviour a normal process already had.
 */

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

interface RequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type KeepAlive = (work: Promise<unknown>) => void;

/**
 * Must be called *during* the request, not from the `finish` listener: the
 * context lives in async-local storage tied to the invocation, and a socket
 * event fires outside it. Capturing early and calling later is what makes the
 * hand-off work.
 */
export function captureKeepAlive(): KeepAlive {
  const host = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as
    | { get?: () => RequestContext | undefined }
    | undefined;

  const waitUntil = host?.get?.()?.waitUntil;
  if (!waitUntil) return () => {};

  return (work) => {
    try {
      waitUntil(work);
    } catch {
      // A stale context is not worth failing a paid request over; the write is
      // best-effort either way.
    }
  };
}
