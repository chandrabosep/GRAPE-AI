import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma 7 requires an explicit driver adapter — `new PrismaClient()` with no
 * arguments throws. We pass the pooled Supabase URL here; migrations use
 * DIRECT_URL via prisma.config.ts instead.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase pooled connection string.',
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * Next.js dev reloads modules on every edit, which would otherwise open a new
 * pool per reload until Postgres refuses connections. Cache on globalThis.
 */
const globalForPrisma = globalThis as unknown as { __aamPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__aamPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__aamPrisma = prisma;
}
