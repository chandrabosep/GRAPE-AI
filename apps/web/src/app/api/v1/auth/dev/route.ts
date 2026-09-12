import { z } from 'zod';
import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '@/server/config';
import { issueSession } from '@/server/modules/auth';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  subject: z.string().default('seed:user-solidity-dev'),
});

/**
 * Development sign-in.
 *
 * Signs in as an existing `seed:` account so the app is usable before Privy
 * credentials exist. Nothing creates those accounts any more, so this answers
 * only where one was made by hand.
 *
 * Two hard gates, because this bypasses identity verification entirely:
 * it refuses in production, and it refuses the moment Privy is configured, so it
 * cannot silently remain a back door once real auth is switched on.
 */
export const POST = route(async (request) => {
  if (env().NODE_ENV === 'production' || env().DISABLE_DEV_AUTH) {
    throw new AppError('not_found', 'Not found');
  }

  const { subject } = await parseBody(request, schema);

  const user = await prisma.user.findUnique({
    where: { subject },
    include: { profile: true },
  });
  if (!user) {
    throw new AppError('not_found', `No user with subject ${subject}.`);
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
