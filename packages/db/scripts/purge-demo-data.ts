/**
 * Removes the fake inventory left over from before `seed-brand-campaigns.ts`.
 *
 * Two things, both of which still bid in live auctions:
 *
 *   1. What the old `prisma/seed.ts` created. The seed is gone, but a database
 *      it already ran against still carries four `[simulated]` advertisers with
 *      their campaigns and creatives, three `[simulated]` users, and the two
 *      plan rows.
 *   2. "Ethereum Developer Launch". The campaign builder used to open pre-filled
 *      with that example, so clicking through it produced a real, active,
 *      $100 campaign owned by a real wallet account — several times over, all
 *      with identical copy. The builder no longer does this, but the campaigns
 *      it already made are indistinguishable duplicates that win auctions.
 *
 *   pnpm --filter @aam/db db:purge-demo          # report only
 *   pnpm --filter @aam/db db:purge-demo --commit # actually delete
 *
 * Real accounts survive in full: their wallets, their advertiser profile, their
 * ledger and their balance. Only the example campaign is taken from them, and
 * `payments.campaign_id` is SET NULL rather than RESTRICT, so a payment that
 * referenced one is kept and merely unlinked.
 *
 * What does go is the delivery history of every deleted campaign — its
 * impressions, engagements and rewards — because `ad_impressions.campaign_id`
 * and `rewards.campaign_id` are RESTRICT and the campaign cannot be deleted
 * around them. That has one consequence worth stating out loud: tier standing
 * is `reward.count()` over a user's lifetime rewards, so deleting reward rows
 * can cost a real developer a rung they had climbed. Balances do not move —
 * `credit_transactions` is the ledger and none of it is touched — but the rows
 * that explain a balance are fewer afterwards. Check the printed reward counts
 * before committing.
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

/**
 * Seeded accounts are the root of everything this removes.
 *
 * `seed:brand-%` is excluded deliberately. That prefix belongs to
 * `seed-brand-campaigns.ts`, which is current demo inventory rather than the
 * dead `prisma/seed.ts` data this script exists to clear — matching the whole
 * `seed:%` namespace would make "remove the old demo advertisers" silently
 * delete the new ones too. Remove those by re-running that script's advertisers
 * out by hand, or widen this on purpose.
 */
const SEEDED = `(select id from users where subject like 'seed:%' and subject not like 'seed:brand-%')`;
const SEEDED_ORG = `(select id from organizations where owner_user_id in ${SEEDED})`;
const SEEDED_ADV = `(select id from advertisers where org_id in ${SEEDED_ORG})`;
const SEEDED_CAMP = `(select id from campaigns where advertiser_id in ${SEEDED_ADV})`;

/**
 * The builder's pre-filled example, wherever it ended up.
 *
 * Matched on the exact name rather than on an id list, because the point is the
 * class of row — every copy anyone produced by clicking through the old
 * prefilled form — and a list would go stale the moment another turned up.
 * The name is specific enough that a real campaign is unlikely to collide, and
 * the report prints the count either way.
 */
const EXAMPLE_CAMP = `(select id from campaigns where name = 'Ethereum Developer Launch')`;

/** Everything being removed, as one set the deletes and the report both use. */
const DOOMED_CAMP = `(${SEEDED_CAMP} union ${EXAMPLE_CAMP})`;
const DOOMED_IMPR = `(select id from ad_impressions where campaign_id in ${DOOMED_CAMP})`;

/** Reported before the fact so the blast radius is reviewable, not implied. */
const doomed: Record<string, string> = {
  users: `select count(*) n from users where id in ${SEEDED}`,
  credit_transactions: `select count(*) n from credit_transactions where user_id in ${SEEDED}`,
  organizations: `select count(*) n from organizations where id in ${SEEDED_ORG}`,
  advertisers: `select count(*) n from advertisers where id in ${SEEDED_ADV}`,
  campaigns: `select count(*) n from campaigns where id in ${DOOMED_CAMP}`,
  ad_creatives: `select count(*) n from ad_creatives where campaign_id in ${DOOMED_CAMP}`,
  ad_impressions: `select count(*) n from ad_impressions where campaign_id in ${DOOMED_CAMP}`,
  ad_engagements: `select count(*) n from ad_engagements where impression_id in ${DOOMED_IMPR}`,
  rewards: `select count(*) n from rewards where campaign_id in ${DOOMED_CAMP}`,
  plans: `select count(*) n from plans`,
};

/**
 * What each real developer loses off their tier ladder.
 *
 * Printed rather than assumed, because `resolveTier` counts lifetime rewards
 * and the ladder is documented as something a developer can never be demoted
 * from. If a line here shows a drop, that promise is about to be broken and the
 * delete should be reconsidered rather than confirmed.
 */
const REWARD_IMPACT = `
  select u.subject,
         count(r.id) filter (where r.id is not null) as total,
         count(r.id) filter (where r.campaign_id in ${DOOMED_CAMP}) as losing
    from users u
    left join rewards r on r.user_id = u.id
   where u.subject not like 'seed:%'
   group by u.subject
  having count(r.id) > 0
   order by u.subject`;

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

/** The tier rung a lifetime reward count reaches, mirroring `resolveTier`. */
function tierName(rewards: number): string {
  if (rewards >= 100) return 'Reserve';
  if (rewards >= 25) return 'Vine';
  return 'Bud';
}

await run(async (client) => {
  console.log('campaigns to delete:');
  const { rows: campaigns } = await client.query(
    `select c.name, c.status, a.name as advertiser, u.subject
       from campaigns c
       join advertisers a on a.id = c.advertiser_id
       join users u on u.id = a.user_id
      where c.id in ${DOOMED_CAMP}
      order by u.subject, c.name`,
  );
  for (const r of campaigns) {
    console.log(`  ${String(r.advertiser).padEnd(20)} "${r.name}" [${r.status}]  ${r.subject}`);
  }

  console.log('\nrows to delete:');
  for (const [label, sql] of Object.entries(doomed)) {
    console.log(`  ${label.padEnd(22)} ${(await client.query(sql)).rows[0].n}`);
  }

  const { rows: impact } = await client.query(REWARD_IMPACT);
  console.log('\ntier impact on real accounts:');
  if (impact.length === 0) console.log('  (none hold rewards)');
  for (const r of impact) {
    const total = Number(r.total);
    const after = total - Number(r.losing);
    const drops = tierName(total) !== tierName(after) ? '   <-- TIER DROPS' : '';
    console.log(
      `  ${String(r.subject).padEnd(52)} rewards ${total} -> ${after}` +
        `  tier ${tierName(total)} -> ${tierName(after)}${drops}`,
    );
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

    // Delivery history first, and in this order.
    //
    // `rewards.campaign_id` and `ad_impressions.campaign_id` are both RESTRICT,
    // so neither the campaign nor the organisation above it can be deleted
    // while a single impression still points at it — and the impressions belong
    // to real accounts, so the later `delete from users` never reaches them.
    // Relying on the cascade from organisations, as this script used to, fails
    // outright against any database that has actually served an ad.
    const rewards = await client.query(`delete from rewards where campaign_id in ${DOOMED_CAMP}`);
    console.log(`\ndeleted rewards: ${rewards.rowCount}`);

    const engagements = await client.query(
      `delete from ad_engagements where impression_id in ${DOOMED_IMPR}`,
    );
    console.log(`deleted ad_engagements: ${engagements.rowCount}`);

    const impressions = await client.query(
      `delete from ad_impressions where campaign_id in ${DOOMED_CAMP}`,
    );
    console.log(`deleted ad_impressions: ${impressions.rowCount}`);

    // Creatives, targeting, daily stats and settlements cascade from here.
    // Payments do not: `payments.campaign_id` is SET NULL, so a real payment
    // survives its campaign rather than being collateral.
    const campaigns = await client.query(`delete from campaigns where id in ${DOOMED_CAMP}`);
    console.log(`deleted campaigns: ${campaigns.rowCount}`);

    // Organizations next: organizations.owner_user_id and advertisers.user_id
    // are RESTRICT, so the seeded users row cannot go while they still point at
    // it. Advertiser profiles belonging to real wallets are left alone — they
    // lost a campaign, not their account.
    const orgs = await client.query(`delete from organizations where owner_user_id in ${SEEDED}`);
    console.log(`deleted organizations: ${orgs.rowCount}`);

    const users = await client.query(`delete from users where id in ${SEEDED}`);
    console.log(`deleted users: ${users.rowCount}`);

    // Plans existed only because the seed wrote them. Nothing references them:
    // `subscriptions.plan_id` is RESTRICT, so this delete fails loudly rather
    // than silently if any account ever holds one.
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
