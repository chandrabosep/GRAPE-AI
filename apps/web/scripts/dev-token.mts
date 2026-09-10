/**
 * Mints a session token for a seeded user so the API can be exercised by hand
 * before Privy keys are wired up.
 *
 * Development only: it bypasses the Privy verification that normally gates
 * account creation, which is exactly why it lives in scripts and refuses to run
 * against a production NODE_ENV.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '..', '.env'), join(here, '..', '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-token must never run against production');
}

const { prisma } = await import('@aam/db');
const { issueSession } = await import('../src/server/modules/auth/session');

const did = process.argv[2] ?? 'did:privy:seed-user-solidity-dev';

const user = await prisma.user.findUnique({
  where: { privyDid: did },
  select: { id: true, displayName: true, creditBalanceMicro: true },
});

if (!user) {
  console.error(`No seeded user with privyDid=${did}. Run: pnpm db:seed`);
  process.exit(1);
}

const session = await issueSession(user.id, 'web', 'dev-token script');

console.log(`user     ${user.displayName ?? user.id}`);
console.log(`credits  $${(Number(user.creditBalanceMicro) / 1_000_000).toFixed(4)}`);
console.log('');
console.log(session.accessToken);

await prisma.$disconnect();
