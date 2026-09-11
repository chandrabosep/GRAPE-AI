/**
 * Copies advertiser accounts and their campaigns from the hosted database into
 * the local one.
 *
 * Moving development onto a local Postgres leaves anything created against the
 * hosted database behind, and "create your advertiser profile" on an account
 * that already has one is a confusing way to find that out. This pulls those
 * rows across so the local database is a superset rather than a fresh start.
 *
 * Only wallet-owned advertisers are copied: seeded accounts already exist
 * locally, courtesy of `pnpm db:seed`. Every write is keyed on the original id
 * and skipped when it is already present, so running it twice changes nothing.
 *
 *   pnpm --filter @aam/db db:import-hosted
 *
 * Reads the hosted URL from SUPABASE_DIRECT_URL (or a --from=<url> argument) and
 * the local one from DATABASE_URL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Commented-out entries count.
 *
 * The hosted URL is expected to be parked behind a `#` once the switch to local
 * has happened, which is exactly when this script is needed.
 */
function loadEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^#?\s*([A-Z_0-9]+)=(.*)$/);
    if (match?.[1] && match[2] !== undefined) {
      values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return values;
}

const fileEnv = loadEnvFile(join(here, '..', '..', '..', '.env'));
const argFrom = process.argv.find((a) => a.startsWith('--from='))?.slice('--from='.length);

const from =
  argFrom ??
  process.env.SUPABASE_DIRECT_URL ??
  fileEnv.SUPABASE_DIRECT_URL ??
  fileEnv.SUPABASE_DATABASE_URL;
const to = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

if (!from) throw new Error('No source database. Set SUPABASE_DIRECT_URL or pass --from=<url>.');
if (!to) throw new Error('No target database. Set DATABASE_URL.');
if (from === to) throw new Error('Source and target are the same database.');

const open = (connectionString: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });

const source = open(from);
const target = open(to);

let copiedAdvertisers = 0;
let copiedCampaigns = 0;
let skipped = 0;

const advertisers = await source.advertiser.findMany({
  include: {
    org: true,
    user: { include: { wallets: true } },
    campaigns: { include: { targeting: true, creatives: true } },
  },
});

for (const advertiser of advertisers) {
  // Seeded advertisers are recreated locally by `pnpm db:seed`; copying them
  // would duplicate campaigns that are already competing in the auction.
  if (!advertiser.user.subject.startsWith('wallet:')) continue;

  // The local account is a different row with the same wallet, because signing
  // in against a fresh database creates a fresh user.
  const address = advertiser.user.wallets[0]?.address;
  const localUser =
    (await target.user.findUnique({ where: { subject: advertiser.user.subject } })) ??
    (address
      ? ((await target.wallet.findFirst({ where: { address }, include: { user: true } }))?.user ??
        null)
      : null);

  if (!localUser) {
    console.log(`skipped ${advertiser.name}: no local account for ${advertiser.user.subject}`);
    skipped += 1;
    continue;
  }

  if (await target.advertiser.findUnique({ where: { id: advertiser.id } })) {
    console.log(`${advertiser.name}: already present`);
  } else {
    await target.organization.upsert({
      where: { id: advertiser.org.id },
      update: {},
      create: {
        id: advertiser.org.id,
        name: advertiser.org.name,
        ownerUserId: localUser.id,
        createdAt: advertiser.org.createdAt,
      },
    });

    await target.advertiser.create({
      data: {
        id: advertiser.id,
        orgId: advertiser.org.id,
        userId: localUser.id,
        name: advertiser.name,
        website: advertiser.website,
        status: advertiser.status,
        createdAt: advertiser.createdAt,
      },
    });

    // The advertiser role is what unlocks the dashboard; without it the local
    // account still lands on "create your advertiser profile".
    if (!localUser.roles.includes('advertiser')) {
      await target.user.update({
        where: { id: localUser.id },
        data: { roles: [...localUser.roles, 'advertiser'] },
      });
    }

    copiedAdvertisers += 1;
    console.log(`copied advertiser ${advertiser.name}`);
  }

  for (const campaign of advertiser.campaigns) {
    if (await target.campaign.findUnique({ where: { id: campaign.id } })) continue;

    await target.campaign.create({
      data: {
        id: campaign.id,
        advertiserId: advertiser.id,
        name: campaign.name,
        status: campaign.status,
        budgetMicro: campaign.budgetMicro,
        // Spend belongs to the impressions recorded against it, and those are
        // not copied, so it restarts at zero rather than claiming a history the
        // local database cannot show.
        spentMicro: 0n,
        bidMicro: campaign.bidMicro,
        clickMultiplier: campaign.clickMultiplier,
        dailySpendCapMicro: campaign.dailySpendCapMicro,
        allocation: campaign.allocation as object,
        frequencyCap: campaign.frequencyCap as object,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        vaultKey: campaign.vaultKey,
        createdAt: campaign.createdAt,
      },
    });

    if (campaign.targeting) {
      const t = campaign.targeting;
      await target.campaignTargeting.create({
        data: {
          id: t.id,
          campaignId: campaign.id,
          countries: t.countries,
          personas: t.personas,
          interests: t.interests,
          technologies: t.technologies,
          intentCategories: t.intentCategories,
          aiIntents: t.aiIntents,
          models: t.models,
          minCommercialIntent: t.minCommercialIntent,
          onchainCriteria: t.onchainCriteria as object,
          onchainMode: t.onchainMode,
        },
      });
    }

    for (const creative of campaign.creatives) {
      await target.adCreative.create({
        data: {
          id: creative.id,
          campaignId: campaign.id,
          headline: creative.headline,
          body: creative.body,
          ctaText: creative.ctaText,
          ctaUrl: creative.ctaUrl,
          imageUrl: creative.imageUrl,
          status: creative.status,
          createdAt: creative.createdAt,
        },
      });
    }

    copiedCampaigns += 1;
    console.log(`  copied campaign ${campaign.name} [${campaign.status}]`);
  }
}

console.log(
  `\ndone: ${copiedAdvertisers} advertiser(s), ${copiedCampaigns} campaign(s), ${skipped} skipped`,
);

await source.$disconnect();
await target.$disconnect();
