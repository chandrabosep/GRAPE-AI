import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '@/server/config';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lists the `seed:` accounts the dev sign-in can use. Same gates as the sign-in itself. */
export const GET = route(async () => {
  if (env().NODE_ENV === 'production' || env().DISABLE_DEV_AUTH) {
    throw new AppError('not_found', 'Not found');
  }

  const users = await prisma.user.findMany({
    where: { subject: { startsWith: 'seed:' } },
    select: { subject: true, displayName: true, roles: true, creditBalanceMicro: true },
    orderBy: { createdAt: 'asc' },
  });

  return json(users);
});
