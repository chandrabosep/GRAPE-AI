import { privyLoginRequestSchema } from '@aam/shared';
import { issueSession, verifyPrivyToken } from '@/server/modules/auth';
import { upsertFromPrivy } from '@/server/modules/users/service';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trades a verified Privy token for our own session. Creates the account on first use. */
export const POST = route(async (request) => {
  const body = await parseBody(request, privyLoginRequestSchema);

  const identity = await verifyPrivyToken(body.privyAccessToken);
  const user = await upsertFromPrivy(identity);
  const session = await issueSession(user.id, 'web', request.headers.get('user-agent') ?? undefined);

  return json({
    ...session,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      creditBalanceMicro: user.creditBalanceMicro,
    },
  });
});
