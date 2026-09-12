import { createApp } from '../src/app';

/**
 * Serverless entrypoint.
 *
 * `src/main.ts` owns the long-lived process and its port; on Vercel there is
 * no port to own — each invocation is handed a request and a response. An
 * Express app is already a `(req, res)` function, so the app itself is the
 * handler. Every path reaches it via the catch-all rewrite in vercel.json,
 * which keeps routing in Express where the paywall can see it: a per-file
 * function layout would put `/v1/inference` outside the middleware that
 * charges for it.
 */
export default createApp();
