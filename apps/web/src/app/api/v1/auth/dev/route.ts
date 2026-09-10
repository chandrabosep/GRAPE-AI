import { z } from 'zod';
import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '@/server/config';
import { issueSession } from '@/server/modules/auth';
import { isPrivyConfigured } from '@/server/modules/auth/privy';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  privyDid: z.string().default('did:privy:seed-user-solidity-dev'),
});

/**
 * Development sign-in.
 *
 * Signs in as a seeded user so the app is usable before Privy credentials
 * exist. Two hard gates, because this bypasses identity verification entirely:
 * it refuses in production, and it refuses the moment Privy is configured, so it
 * cannot silently remain a back door once real auth is switched on.
 */
export const POST = route(async (request) => {
  if (env().NODE_ENV === 'production' || isPrivyConfigured()) {
    throw new AppError('not_found', 'Not found');
  }

  const { privyDid } = await parseBody(request, schema);

  const user = await prisma.user.findUnique({
    where: { privyDid },
    include: { profile: true },
  });
  if (!user) {
    throw new AppError('not_found', `No seeded user ${privyDid}. Run pnpm db:seed.`);
  }

  const session = await issueSession(user.id, 'web', 'dev sign-in');

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
