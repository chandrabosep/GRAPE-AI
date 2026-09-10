import { z } from 'zod';
import { issueSession, verifySiwe, walletSubject } from '@/server/modules/auth';
import { upsertFromIdentity } from '@/server/modules/users/service';
import { prisma } from '@aam/db';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  message: z.string().min(20).max(4000),
  signature: z.string().min(20).max(500),
});

/**
 * Verifies a signed SIWE message and starts a session.
 *
 * The wallet that signs in is also recorded as the user's wallet, but not as
 * their targeting signal source. That stays an explicit, separate choice: a
 * wallet used to log in should not silently start feeding an ad engine.
 */
export const POST = route(async (request) => {
  const { message, signature } = await parseBody(request, schema);

  const { address } = await verifySiwe(message, signature);

  const user = await upsertFromIdentity({
    subject: walletSubject(address),
    displayName: `${address.slice(0, 6)}…${address.slice(-4)}`,
  });

  await prisma.wallet.upsert({
    where: { address_chainType: { address, chainType: 'evm' } },
    create: {
      userId: user.id,
      address,
      chainType: 'evm',
      kind: 'linked_external',
      isPrimarySignalSource: false,
      verifiedAt: new Date(),
    },
    update: { verifiedAt: new Date() },
  });

  const session = await issueSession(user.id, 'web', request.headers.get('user-agent') ?? undefined);

  return json({
    ...session,
    user: {
      id: user.id,
      displayName: user.displayName,
      roles: user.roles,
      creditBalanceMicro: user.creditBalanceMicro,
    },
  });
});
