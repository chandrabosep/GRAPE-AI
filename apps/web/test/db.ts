import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * A real Postgres for integration tests, with no Docker and no network.
 *
 * PGlite speaks the wire protocol over a socket, so Prisma's ordinary driver
 * adapter connects to it unchanged and the tests exercise the same SQL, the
 * same transactions and the same triggers that production will run. Each suite
 * gets its own port and its own in-memory database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  here,
  '../../../packages/db/prisma/migrations/20260909000000_init/migration.sql',
);

export interface TestDatabase {
  connectionString: string;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();
  await db.exec(readFileSync(MIGRATION, 'utf8'));

  // Random high port so parallel suites cannot collide.
  const port = 55_000 + Math.floor(Math.random() * 9_000);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();

  // One connection at a time is all the socket server serves.
  process.env.PRISMA_POOL_MAX = '1';

  return {
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
