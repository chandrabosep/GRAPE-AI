/**
 * Applies the database guarantees Prisma cannot express (append-only ledger).
 * Idempotent: safe to run after every migration.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', 'prisma', 'sql');

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set');

const client = new Client({ connectionString: url });
await client.connect();

const files = readdirSync(sqlDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  process.stdout.write(`applying ${file} ... `);
  await client.query(readFileSync(join(sqlDir, file), 'utf8'));
  console.log('ok');
}

await client.end();
console.log(`database hardened (${files.length} script(s))`);
