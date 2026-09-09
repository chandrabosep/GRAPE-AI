import { vscodeExchangeRequestSchema } from '@aam/shared';
import { redeemHandoffCode } from '@/server/modules/auth';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public by design: the single-use code and matching state are the credential. */
export const POST = route(async (request) => {
  const body = await parseBody(request, vscodeExchangeRequestSchema);
  const session = await redeemHandoffCode(
    body.code,
    body.state,
    request.headers.get('user-agent') ?? undefined,
  );
  return json(session);
});
