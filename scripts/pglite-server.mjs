#!/usr/bin/env node
/**
 * Embedded Postgres for development and tests.
 *
 * Speaks the Postgres wire protocol on a TCP port, so Prisma's ordinary pg
 * driver adapter connects to it unchanged. This exists because a real database
 * should not be a prerequisite for running the test suite: no Docker, no
 * Supabase account, no network. Production and the demo still use Supabase.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PGLITE_PORT ?? 55432);
const dataDir = process.env.PGLITE_DIR ?? undefined; // undefined = in-memory

const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });

await server.start();
console.log(`pglite listening on 127.0.0.1:${port}${dataDir ? ` (${dataDir})` : ' (in-memory)'}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
