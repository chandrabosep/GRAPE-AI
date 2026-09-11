/**
 * Development only: adds credits to a seeded account.
 *
 * Exists so end-to-end probes against real inference can run to completion
 * without the starter grant running out mid-test. Refuses in production for the
 * same reason dev-token does — it mints money.
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
  throw new Error('topup must never run against production');
}

const { prisma } = await import('@aam/db');
const { creditPurchase, getBalance } = await import('../src/server/modules/credits/service');

const subject = process.argv[2] ?? 'seed:user-devops';
const dollars = Number(process.argv[3] ?? '5');

const user = await prisma.user.findUniqueOrThrow({
  where: { subject },
  select: { id: true, displayName: true },
});

await creditPurchase(user.id, BigInt(Math.round(dollars * 1_000_000)), `topup-${Date.now()}`);

const balance = await getBalance(user.id);
console.log(`${user.displayName ?? subject}: $${(Number(balance) / 1e6).toFixed(4)}`);

await prisma.$disconnect();
