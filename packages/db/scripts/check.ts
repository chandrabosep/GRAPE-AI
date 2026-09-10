/**
 * Verifies a database is actually ready to run against.
 *
 * Migrating and seeding can both succeed while leaving something important
 * missing, so this checks the things that would otherwise fail quietly much
 * later: that the tables exist, that seed data is present, and — the one that
 * matters most — that the append-only ledger trigger is really enforced on
 * *this* database rather than only on the one it was tested against.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '..', '.env'), join(here, '..', '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set');

const client = new Client({ connectionString: url });
await client.connect();

const host = url.replace(/.*@([^:/]+).*/, '$1');
console.log(`database: ${host}\n`);

const { rows: tables } = await client.query(
  "select count(*)::int n from information_schema.tables where table_schema = 'public'",
);
console.log(`tables            ${tables[0].n}`);

for (const table of ['plans', 'advertisers', 'campaigns', 'ad_creatives', 'users', 'wallets']) {
  const { rows } = await client.query(`select count(*)::int n from ${table}`);
  console.log(`${table.padEnd(18)}${rows[0].n}`);
}

const { rows: campaigns } = await client.query(
  'select name, status from campaigns order by status, name',
);
console.log('\ncampaigns:');
for (const row of campaigns) console.log(`  ${String(row.status).padEnd(9)} ${row.name}`);

// The ledger guarantee, checked where it actually has to hold.
const { rows: entries } = await client.query('select id from credit_transactions limit 1');
console.log('');
if (entries.length === 0) {
  console.log('ledger            no rows yet, trigger not exercised');
} else {
  try {
    await client.query(`update credit_transactions set amount_micro = 1 where id = $1`, [
      entries[0].id,
    ]);
    console.error('ledger            NOT PROTECTED — append-only trigger is missing');
    await client.end();
    process.exit(1);
  } catch (error) {
    const message = String((error as Error).message).split('\n')[0];
    console.log(`ledger            protected (${message})`);
  }
}

await client.end();
console.log('\nok');
