import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '@/server/config';
import { isPrivyConfigured } from '@/server/modules/auth/privy';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lists the seeded accounts the dev sign-in can use. Same gates as the sign-in itself. */
export const GET = route(async () => {
  if (env().NODE_ENV === 'production' || isPrivyConfigured()) {
    throw new AppError('not_found', 'Not found');
  }

  const users = await prisma.user.findMany({
    where: { privyDid: { startsWith: 'did:privy:seed-' } },
    select: { privyDid: true, displayName: true, roles: true, creditBalanceMicro: true },
    orderBy: { createdAt: 'asc' },
  });

  return json(users);
});
