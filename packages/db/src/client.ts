import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma 7 requires an explicit driver adapter — `new PrismaClient()` with no
 * arguments throws. The pooled Supabase URL is passed here; migrations use
 * DIRECT_URL via prisma.config.ts instead.
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase pooled connection string.',
    );
  }

  // PGlite (used by the integration tests) serves one connection at a time, so
  // the pool must be pinned to 1 there. Supabase gets a normal pool.
  const max = process.env.PRISMA_POOL_MAX ? Number(process.env.PRISMA_POOL_MAX) : undefined;
  const adapter = new PrismaPg({ connectionString, ...(max ? { max } : {}) });

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

function instance(): PrismaClient {
  if (!globalForPrisma.__aamPrisma) {
    globalForPrisma.__aamPrisma = createClient();
  }
  return globalForPrisma.__aamPrisma;
}

/**
 * Constructed on first use, not on import.
 *
 * Importing a module that merely mentions the database should not require a
 * connection string. Eager construction meant a unit test for pure logic, or a
 * build step that only walks imports, would fail for want of a database it never
 * touches.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(instance(), property, receiver);
    return typeof value === 'function' ? value.bind(instance()) : value;
  },
  has(_target, property) {
    return property in instance();
  },
});
