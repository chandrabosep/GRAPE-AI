/**
 * Removes the demo data the old `prisma/seed.ts` used to create.
 *
 * The seed is gone, but a database it already ran against still carries its
 * rows: four `[simulated]` advertisers with their campaigns and creatives,
 * three `[simulated]` users, and the two plan rows. This deletes exactly those
 * and nothing else — every account whose subject does not begin `seed:` is left
 * alone, along with its ledger.
 *
 *   pnpm --filter @aam/db db:purge-demo          # report only
 *   pnpm --filter @aam/db db:purge-demo --commit # actually delete
 *
 * Balances are safe. They are read from `users.credit_balance_micro` and
 * `credit_transactions`, and no row belonging to a real account is touched; the
 * script prints every real balance before and after so that is visible rather
 * than promised.
 *
 * The ledger's append-only triggers have to come off for the duration, because
 * deleting a seeded user cascades into their `credit_transactions`. That
 * happens inside the transaction and is undone before it commits, so a failure
 * anywhere rolls the protection back with everything else. Run
 * `pnpm --filter @aam/db db:harden` afterwards if you want belt and braces.
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

const commit = process.argv.includes('--commit');

/** Seeded accounts are the root of everything this removes. */
const SEEDED = `(select id from users where subject like 'seed:%')`;
const SEEDED_ORG = `(select id from organizations where owner_user_id in ${SEEDED})`;
const SEEDED_ADV = `(select id from advertisers where org_id in ${SEEDED_ORG})`;
const SEEDED_CAMP = `(select id from campaigns where advertiser_id in ${SEEDED_ADV})`;
const SEEDED_IMPR = `(select id from ad_impressions where campaign_id in ${SEEDED_CAMP})`;

/** Reported before the fact so the blast radius is reviewable, not implied. */
const doomed: Record<string, string> = {
  users: `select count(*) n from users where subject like 'seed:%'`,
  credit_transactions: `select count(*) n from credit_transactions where user_id in ${SEEDED}`,
  organizations: `select count(*) n from organizations where id in ${SEEDED_ORG}`,
  advertisers: `select count(*) n from advertisers where id in ${SEEDED_ADV}`,
  campaigns: `select count(*) n from campaigns where id in ${SEEDED_CAMP}`,
  ad_creatives: `select count(*) n from ad_creatives where campaign_id in ${SEEDED_CAMP}`,
  ad_impressions: `select count(*) n from ad_impressions where campaign_id in ${SEEDED_CAMP}`,
  rewards: `select count(*) n from rewards where impression_id in ${SEEDED_IMPR}`,
  plans: `select count(*) n from plans`,
};

/**
 * PGlite serves one connection at a time and `pnpm dev` holds it, so a lone
 * attempt dies with ECONNRESET whenever the app is mid-query — and the reset
 * lands on a query as readily as on the connect. Retry the whole unit of work
 * into the gaps rather than making the caller stop the dev server. Each attempt
 * gets a fresh client, and the delete runs in one transaction, so a retry never
 * resumes half-finished work.
 */
async function run<T>(work: (client: Client) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString: url });
    client.on('error', () => {});
    try {
      await client.connect();
      const result = await work(client);
      await client.end().catch(() => {});
      return result;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= 25) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

/** Real accounts, printed either side of the delete so the ledger is visibly untouched. */
async function realBalances(client: Client): Promise<string> {
  const { rows } = await client.query(
    `select subject, credit_balance_micro from users
      where subject not like 'seed:%' order by created_at`,
  );
  if (rows.length === 0) return '(no real accounts)';
  return rows.map((r) => `${r.subject} = ${r.credit_balance_micro}`).join(', ');
}

await run(async (client) => {
  console.log('to delete:');
  for (const [label, sql] of Object.entries(doomed)) {
    console.log(`  ${label.padEnd(22)} ${(await client.query(sql)).rows[0].n}`);
  }
  console.log(`\nreal balances before: ${await realBalances(client)}`);
});

if (!commit) {
  console.log('\nreport only — pass --commit to delete');
  process.exit(0);
}

await run(async (client) => {
  await client.query('begin');
  try {
    await client.query(`
      drop trigger if exists credit_transactions_no_update on credit_transactions;
      drop trigger if exists credit_transactions_no_delete on credit_transactions;`);

    // Organizations first: organizations.owner_user_id and advertisers.user_id
    // are RESTRICT, so the users row cannot go while they still point at it.
    // From there the cascades do the rest — advertisers, campaigns, targeting,
    // creatives, impressions, engagements, rewards.
    const orgs = await client.query(`delete from organizations where owner_user_id in ${SEEDED}`);
    console.log(`\ndeleted organizations: ${orgs.rowCount}`);

    const users = await client.query(`delete from users where subject like 'seed:%'`);
    console.log(`deleted users: ${users.rowCount}`);

    // Plans existed only because the seed wrote them; nothing reads them.
    const plans = await client.query(`delete from plans`);
    console.log(`deleted plans: ${plans.rowCount}`);

    await client.query(`
      create trigger credit_transactions_no_update
        before update on credit_transactions
        for each row execute function aam_block_ledger_mutation();
      create trigger credit_transactions_no_delete
        before delete on credit_transactions
        for each row execute function aam_block_ledger_mutation();`);

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }

  console.log('committed; ledger triggers restored');
  console.log(`real balances after:  ${await realBalances(client)}`);
});
