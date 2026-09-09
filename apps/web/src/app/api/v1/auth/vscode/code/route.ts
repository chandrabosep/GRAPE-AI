import { vscodeCodeRequestSchema } from '@aam/shared';
import { authenticate, createHandoffCode } from '@/server/modules/auth';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by the signed-in browser during the editor handoff. Returns a
 * single-use code the extension can exchange; nothing sensitive travels in the
 * callback URL.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const body = await parseBody(request, vscodeCodeRequestSchema);

  const code = await createHandoffCode(user.id, body.state);
  return json({ code, expiresInSeconds: 300 });
});
