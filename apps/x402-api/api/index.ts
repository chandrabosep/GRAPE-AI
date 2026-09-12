import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app';

/**
 * Serverless entrypoint.
 *
 * `src/main.ts` owns the long-lived process and its port; on Vercel there is
 * no port to own — each invocation is handed a request and a response. An
 * Express app is already a `(req, res)` function, so the app itself does the
 * work. Every path reaches it via the catch-all rewrite in vercel.json, which
 * keeps routing in Express where the paywall can see it: a per-file function
 * layout would put `/v1/inference` outside the middleware that charges for it.
 */

type App = ReturnType<typeof createApp>;

let app: App | null = null;
let failure: Error | null = null;

/**
 * Built on the first request rather than at import.
 *
 * Construction reads the environment and opens the facilitator sync, either of
 * which can throw. Thrown at module scope that becomes FUNCTION_INVOCATION_FAILED
 * — a generic crash page with the actual reason buried in a log the caller
 * cannot see. Deferring it means a misconfigured deployment answers every
 * request with the name of what is missing, which is the difference between a
 * one-minute fix and a bisect.
 */
function instance(): App | null {
  if (app || failure) return app;
  try {
    app = createApp();
  } catch (error) {
    failure = error as Error;
  }
  return app;
}

/**
 * The facilitator sync starts as a floating promise inside the x402 middleware
 * and is only awaited when the first paid request arrives. If it rejects in the
 * gap, Node's default is to kill the process — here, the whole instance, taking
 * the free discovery routes down with it for a dependency they never needed.
 * Log it and let the paid routes surface the failure themselves.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[x402] unhandled rejection:', reason);
});

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const ready = instance();

  if (!ready) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'misconfigured', detail: failure?.message ?? 'unknown' }));
    return;
  }

  ready(req, res);
}
