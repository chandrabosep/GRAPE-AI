import { issueNonce } from '@/server/modules/auth';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issues a single-use nonce for Sign-In With Ethereum.
 *
 * Public by necessity: it is requested before anyone is authenticated. The nonce
 * grants nothing on its own — it only becomes meaningful once signed by an
 * address, and it can be redeemed exactly once.
 */
export const GET = route(async () => {
  return json({ nonce: await issueNonce() });
});
