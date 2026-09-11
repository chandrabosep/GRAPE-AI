/**
 * Demo data.
 *
 * Campaigns here are built to make the auction visible rather than to flatter
 * it. They deliberately overlap and compete, one bids high with weak targeting
 * so it can be seen losing to a cheaper but relevant campaign, and one requires
 * onchain history so it only becomes eligible once a wallet with real activity
 * is linked.
 *
 * Users are labelled [simulated], but the wallet addresses are real, public,
 * active mainnet addresses. Onchain signals are never faked: they are computed
 * live from The Graph against these addresses at request time.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// The workspace keeps one .env at the repo root, but this script runs with
// cwd=packages/db. Load it here so `pnpm db:seed` works without the caller
// having to export anything first.
const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '..', '.env'), join(here, '..', '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

/**
 * Creative artwork is served by the web app, so a campaign image is a normal
 * URL the VS Code webview can load under its image CSP. Absolute, because the
 * extension renders these from a different origin than the one that stored them.
 */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const creativeImage = (file: string) => `${APP_URL}/creatives/${file}.svg`;

/** Snapshotted onto each campaign so later config changes cannot rewrite it. */
const ALLOCATION = { reward: 0.7, platform: 0.2, treasury: 0.1 };

/**
 * Deliberately loose for demo data.
 *
 * A production cap of one card per advertiser per hour makes a live demo look
 * broken: the second question of the same kind returns nothing. The cap
 * mechanism is unchanged and still enforced — only these seeded numbers are
 * generous.
 */
const DEMO_FREQUENCY_CAP = { perUserPerHour: 5, perUserPerDay: 25 };

const IN_30_DAYS = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function main() {
  console.log('seeding...');

  // --- plans ---------------------------------------------------------------
  // Credits are the only currency, so a plan gates model access and ad
  // behaviour rather than granting an allowance.
  await prisma.plan.upsert({
    where: { code: 'FREE' },
    update: {},
    create: {
      code: 'FREE',
      name: 'Free',
      dailyTokenAllowance: 0,
      allowedModels: ['us.anthropic.claude-sonnet-5', 'fake-standard'],
      adsEnabled: true,
      priceMicro: 0n,
      sortOrder: 0,
      features: { starterGrant: true },
    },
  });

  await prisma.plan.upsert({
    where: { code: 'PRO' },
    update: {},
    create: {
      code: 'PRO',
      name: 'Pro',
      dailyTokenAllowance: 0,
      allowedModels: [
        'us.anthropic.claude-sonnet-5',
        'us.anthropic.claude-opus-5',
        'fake-standard',
      ],
      adsEnabled: false,
      priceMicro: USD(20),
      sortOrder: 1,
      features: { premiumModels: true, adFree: true },
    },
  });

  // --- advertisers ---------------------------------------------------------
  const advertiserSpecs = [
    {
      key: 'rpc',
      company: 'Northwind RPC',
      website: 'https://example.com/northwind',
      email: 'ads@northwind.example',
    },
    {
      key: 'tooling',
      company: 'Forgeline Devtools',
      website: 'https://example.com/forgeline',
      email: 'ads@forgeline.example',
    },
    {
      key: 'cloud',
      company: 'Meridian Cloud',
      website: 'https://example.com/meridian',
      email: 'ads@meridian.example',
    },
    {
      key: 'analytics',
      company: 'Lattice Analytics',
      website: 'https://example.com/lattice',
      email: 'ads@lattice.example',
    },
  ];

  const advertisers: Record<string, string> = {};

  for (const spec of advertiserSpecs) {
    const user = await prisma.user.upsert({
      where: { subject: `seed:advertiser-${spec.key}` },
      update: {},
      create: {
        subject: `seed:advertiser-${spec.key}`,
        email: spec.email,
        displayName: `${spec.company} [simulated]`,
        roles: ['user', 'advertiser'],
        profile: { create: {} },
      },
    });

    const org = await prisma.organization.upsert({
      where: { id: (await prisma.organization.findFirst({ where: { name: spec.company } }))?.id ?? randomUUID() },
      update: {},
      create: { name: spec.company, ownerUserId: user.id },
    });

    const advertiser =
      (await prisma.advertiser.findFirst({ where: { orgId: org.id } })) ??
      (await prisma.advertiser.create({
        data: { orgId: org.id, userId: user.id, name: spec.company, website: spec.website },
      }));

    advertisers[spec.key] = advertiser.id;
  }

  // --- campaigns -----------------------------------------------------------
  const campaigns = [
    {
      advertiser: 'rpc',
      name: 'Ethereum Developer Launch',
      budget: USD(100),
      bid: USD(0.01),
      targeting: {
        // Deliberately not country-locked. This is the campaign the demo leans
        // on, and a developer whose country we cannot resolve would otherwise
        // be ineligible for the one ad that actually matches their question.
        countries: [],
        personas: ['web3_developer'],
        interests: ['web3', 'infrastructure'],
        technologies: ['solidity', 'ethereum', 'foundry', 'viem'],
        intentCategories: ['infrastructure'],
        aiIntents: ['smart_contract_deployment', 'rpc_infrastructure_evaluation'],
        minCommercialIntent: 'medium',
        onchainMode: 'boost' as const,
        onchainCriteria: {
          requireWalletActivity: true,
          protocolTypes: [],
          protocols: [],
          activityWindowDays: 30,
          requireEnsHolder: false,
          requireStablecoinHolder: false,
          requireNftHolder: false,
          chains: ['mainnet'],
        },
      },
      creatives: {
        banner: {
        headline: 'Ship your contract without babysitting a node',
        body: 'Managed Ethereum RPC with archive access and no rate-limit surprises. Free tier covers most testnet work.',
        ctaText: 'See the free tier',
        ctaUrl: 'https://example.com/northwind?utm_source=aam',
        imageUrl: creativeImage('northwind-rpc'),
        },
        inline: {
          headline: 'Managed Ethereum RPC, archive access included',
          ctaText: 'Free tier',
          ctaUrl: 'https://example.com/northwind?utm_source=aam',
        },
      },
    },
    {
      advertiser: 'analytics',
      name: 'DeFi Builders — Onchain Required',
      budget: USD(75),
      bid: USD(0.014),
      targeting: {
        countries: [],
        personas: ['web3_developer'],
        interests: ['defi', 'data'],
        technologies: ['thegraph', 'subgraph', 'ethereum'],
        intentCategories: ['data'],
        aiIntents: ['indexing_querying_onchain_data', 'defi_integration'],
        minCommercialIntent: 'low',
        // Only reachable once a wallet with real lending or DEX history is linked.
        onchainMode: 'require' as const,
        onchainCriteria: {
          requireWalletActivity: true,
          protocolTypes: ['lending', 'dex'],
          protocols: [],
          activityWindowDays: 30,
          requireEnsHolder: false,
          requireStablecoinHolder: false,
          requireNftHolder: false,
          chains: ['mainnet'],
        },
      },
      creatives: {
        banner: {
        headline: 'Query any protocol with one schema',
        body: 'Standardised subgraphs across lending and DEX protocols. Write the query once, point it anywhere.',
        ctaText: 'Read the docs',
        ctaUrl: 'https://example.com/lattice?utm_source=aam',
        imageUrl: creativeImage('lattice-subgraph'),
        },
        inline: {
          headline: 'One subgraph schema across every lending protocol',
          ctaText: 'Read the docs',
          ctaUrl: 'https://example.com/lattice?utm_source=aam',
        },
      },
    },
    {
      advertiser: 'tooling',
      name: 'Contract Testing Push',
      budget: USD(50),
      bid: USD(0.008),
      targeting: {
        countries: [],
        personas: ['web3_developer'],
        interests: ['devtools'],
        technologies: ['foundry', 'solidity', 'hardhat'],
        intentCategories: ['development'],
        aiIntents: ['smart_contract_testing', 'smart_contract_audit', 'smart_contract_development'],
        minCommercialIntent: 'low',
        onchainMode: 'off' as const,
        onchainCriteria: {},
      },
      creatives: {
        banner: {
        headline: 'Fuzz your invariants before an auditor does',
        body: 'Property-based testing for Solidity that plugs into your existing Foundry setup.',
        ctaText: 'Try it',
        ctaUrl: 'https://example.com/forgeline?utm_source=aam',
        imageUrl: creativeImage('forgeline-fuzz'),
        },
        inline: {
          headline: 'Fuzz Solidity invariants inside your Foundry setup',
          ctaText: 'Try it',
          ctaUrl: 'https://example.com/forgeline?utm_source=aam',
        },
      },
    },
    {
      advertiser: 'cloud',
      name: 'Deploy Anywhere',
      budget: USD(120),
      bid: USD(0.011),
      targeting: {
        // Keeps country targeting represented in the seed data.
        countries: ['IN', 'US', 'GB', 'DE'],
        personas: ['devops_engineer', 'backend_developer'],
        interests: ['infrastructure', 'devtools'],
        technologies: ['docker', 'kubernetes', 'terraform', 'aws'],
        intentCategories: ['infrastructure'],
        aiIntents: ['devops_deployment', 'cloud_infrastructure'],
        minCommercialIntent: 'medium',
        onchainMode: 'off' as const,
        onchainCriteria: {},
      },
      creatives: {
        banner: {
        headline: 'From Dockerfile to production in one command',
        body: 'Container hosting with preview environments per branch and no YAML to maintain.',
        ctaText: 'Deploy a test app',
        ctaUrl: 'https://example.com/meridian?utm_source=aam',
        imageUrl: creativeImage('meridian-deploy'),
        },
        inline: {
          headline: 'Dockerfile to production in a single command',
          ctaText: 'Deploy one',
          ctaUrl: 'https://example.com/meridian?utm_source=aam',
        },
      },
    },
    {
      advertiser: 'cloud',
      name: 'Broad Reach (high bid, weak targeting)',
      budget: USD(200),
      bid: USD(0.03),
      // Deliberately vague. Exists so the demo can show a campaign bidding three
      // times the going rate and still losing to a relevant one, because bid
      // alone cannot buy its way past the relevance floor.
      targeting: {
        countries: [],
        personas: [],
        interests: [],
        technologies: [],
        intentCategories: [],
        aiIntents: [],
        minCommercialIntent: 'low',
        onchainMode: 'off' as const,
        onchainCriteria: {},
      },
      creatives: {
        banner: {
        headline: 'Cloud hosting for every team',
        body: 'Scalable infrastructure for whatever you are building.',
        ctaText: 'Learn more',
        ctaUrl: 'https://example.com/meridian-general?utm_source=aam',
        imageUrl: creativeImage('meridian-hosting'),
        },
        inline: {
          headline: 'Container hosting that scales without the YAML',
          ctaText: 'Learn more',
          ctaUrl: 'https://example.com/meridian-general?utm_source=aam',
        },
      },
    },
    {
      advertiser: 'tooling',
      name: 'Debugging Assistant (paused)',
      budget: USD(30),
      bid: USD(0.009),
      status: 'paused' as const,
      targeting: {
        countries: [],
        personas: [],
        interests: ['devtools'],
        technologies: ['typescript', 'node'],
        intentCategories: ['debugging'],
        aiIntents: ['bug_fixing'],
        minCommercialIntent: 'low',
        onchainMode: 'off' as const,
        onchainCriteria: {},
      },
      creatives: {
        banner: {
        headline: 'Stack traces that point at your code',
        body: 'Source-mapped error tracking for Node services.',
        ctaText: 'Start free',
        ctaUrl: 'https://example.com/forgeline-debug?utm_source=aam',
        imageUrl: creativeImage('forgeline-traces'),
        },
        inline: {
          headline: 'Source-mapped stack traces for Node services',
          ctaText: 'Start free',
          ctaUrl: 'https://example.com/forgeline-debug?utm_source=aam',
        },
      },
    },
  ];

  /**
   * Writes both sponsored formats for a campaign.
   *
   * Upserted per format rather than blanket-updated, so re-seeding a database
   * that has been demoed against refreshes each slot in place instead of
   * leaving a stale banner and a new inline line disagreeing with each other.
   */
  async function writeCreatives(
    campaignId: string,
    creatives: (typeof campaigns)[number]['creatives'],
  ): Promise<void> {
    await prisma.adCreative.upsert({
      where: { campaignId_format: { campaignId, format: 'banner' } },
      create: { campaignId, format: 'banner', ...creatives.banner },
      update: creatives.banner,
    });

    await prisma.adCreative.upsert({
      where: { campaignId_format: { campaignId, format: 'inline' } },
      create: { campaignId, format: 'inline', body: null, ...creatives.inline },
      update: { body: null, imageUrl: null, ...creatives.inline },
    });
  }

  for (const spec of campaigns) {
    const existing = await prisma.campaign.findMany({ where: { name: spec.name } });

    // Artwork and copy are refreshed on every run even for campaigns that
    // already exist, so re-seeding an established demo database picks up a new
    // creative instead of silently keeping the old one. Every matching campaign
    // is updated, not just the first: a database that has been demoed against
    // for a while accumulates duplicates, and a stale one still wins auctions.
    if (existing.length > 0) {
      for (const campaign of existing) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { frequencyCap: DEMO_FREQUENCY_CAP },
        });
        await writeCreatives(campaign.id, spec.creatives);
      }
      continue;
    }

    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: advertisers[spec.advertiser]!,
        name: spec.name,
        status: spec.status ?? 'active',
        budgetMicro: spec.budget,
        bidMicro: spec.bid,
        allocation: ALLOCATION,
        startsAt: YESTERDAY,
        endsAt: IN_30_DAYS,
        vaultKey: `0x${randomUUID().replace(/-/g, '')}`,
        frequencyCap: DEMO_FREQUENCY_CAP,
      },
    });

    await prisma.campaignTargeting.create({
      data: {
        campaignId: campaign.id,
        countries: spec.targeting.countries,
        personas: spec.targeting.personas,
        interests: spec.targeting.interests,
        technologies: spec.targeting.technologies,
        intentCategories: spec.targeting.intentCategories,
        aiIntents: spec.targeting.aiIntents,
        models: [],
        minCommercialIntent: spec.targeting.minCommercialIntent,
        onchainMode: spec.targeting.onchainMode,
        onchainCriteria: spec.targeting.onchainCriteria,
      },
    });

    await writeCreatives(campaign.id, spec.creatives);
  }

  // --- demo users ----------------------------------------------------------
  // Real, public, active mainnet addresses. We never fabricate onchain signals;
  // these exist so The Graph has genuine history to derive them from.
  const demoUsers = [
    {
      key: 'solidity-dev',
      name: 'Ada [simulated]',
      country: 'IN',
      persona: 'web3_developer',
      interests: ['web3', 'defi', 'devtools'],
      technologies: ['solidity', 'foundry', 'ethereum'],
      wallet: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    },
    {
      key: 'fullstack-dev',
      name: 'Bo [simulated]',
      country: 'US',
      persona: 'fullstack_developer',
      interests: ['devtools', 'ai'],
      technologies: ['typescript', 'nextjs', 'postgres'],
      wallet: '0x28C6c06298d514Db089934071355E5743bf21d60',
    },
    {
      key: 'devops',
      name: 'Cy [simulated]',
      country: 'DE',
      persona: 'devops_engineer',
      interests: ['infrastructure'],
      technologies: ['docker', 'kubernetes', 'terraform'],
      wallet: null,
    },
  ];

  for (const spec of demoUsers) {
    const user = await prisma.user.upsert({
      where: { subject: `seed:user-${spec.key}` },
      update: {},
      create: {
        subject: `seed:user-${spec.key}`,
        displayName: spec.name,
        countryCode: spec.country,
        creditBalanceMicro: 0n,
        profile: {
          create: {
            persona: spec.persona,
            interests: spec.interests,
            technologies: spec.technologies,
          },
        },
      },
    });

    // Starter grant, through the ledger so the balance chain stays valid.
    const existingGrant = await prisma.creditTransaction.findFirst({
      where: { userId: user.id, type: 'promo' },
    });
    if (!existingGrant) {
      const amount = USD(0.5);
      await prisma.creditTransaction.create({
        data: {
          userId: user.id,
          type: 'promo',
          amountMicro: amount,
          balanceAfterMicro: amount,
          refType: 'seed',
          refId: user.id,
          idempotencyKey: `seed-promo-${user.id}`,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { creditBalanceMicro: amount },
      });
    }

    if (spec.wallet) {
      await prisma.wallet.upsert({
        where: { address_chainType: { address: spec.wallet, chainType: 'evm' } },
        update: {},
        create: {
          userId: user.id,
          address: spec.wallet,
          chainType: 'evm',
          kind: 'linked_external',
          isPrimarySignalSource: true,
          verifiedAt: new Date(),
        },
      });
    }
  }

  const counts = {
    plans: await prisma.plan.count(),
    advertisers: await prisma.advertiser.count(),
    campaigns: await prisma.campaign.count(),
    creatives: await prisma.adCreative.count(),
    users: await prisma.user.count(),
    wallets: await prisma.wallet.count(),
  };
  console.log('seeded:', counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
