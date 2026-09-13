/**
 * Demo inventory built from real developer products.
 *
 *   pnpm --filter @aam/db db:seed-brands
 *   pnpm --filter @aam/db db:seed-brands --app-url=https://grape-ai-dev.vercel.app
 *
 * The old `prisma/seed.ts` invented four companies, which made the auction
 * demonstrable but made every card look like placeholder text. These are the
 * products a developer using this extension actually evaluates — Postgres,
 * auth, voice, hosting, deploys, error monitoring, RPC — so the sponsored slot
 * can be judged on whether the ad was worth showing rather than on whether the
 * copy was believable.
 *
 * None of these companies is affiliated with this project, has been contacted,
 * or has paid anything. This is unsold demo inventory wearing real names:
 *
 *   - Every factual claim in the copy is taken from the company's own public
 *     pricing or documentation page, checked on 13 September 2026. Claims were
 *     chosen to be stable — free-tier shapes and product descriptions rather
 *     than promotional prices, which move.
 *   - Artwork in `apps/web/public/creatives/brands/` is each company's official
 *     mark from Simple Icons (CC0), placed on a brand-coloured tile. No
 *     wordmark is reproduced except as plain text on the wide banners.
 *   - The advertiser accounts carry `subject: "seed:brand-<slug>"`, so
 *     `pnpm --filter @aam/db db:purge-demo` removes all of this, and
 *     `db:import-hosted` never copies it.
 *
 * Campaigns are created `active`, because inventory that needs a dashboard
 * visit before it serves is not a seed. Nine campaigns across eight
 * advertisers, deliberately overlapping: Supabase and Neon both bid on
 * `database_design`, Vercel and Hostinger both bid on `devops_deployment`, and
 * the auction picks between them on relevance rather than on being the only
 * option. Hostinger also runs one campaign with no targeting at all, which is
 * the only kind `selectRemnant` will use to fill a slot nothing else wanted.
 *
 * Re-running is safe and is how copy is edited: creatives and targeting are
 * upserted, so changing a headline here and re-running publishes it. Budget,
 * spend and status of a campaign that already exists are never touched —
 * raising a budget or resurrecting an ended campaign is a decision, not a seed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

for (const candidate of [join(repoRoot, '.env'), join(here, '..', '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

/**
 * Read from the same file the server reads rather than copied into a constant,
 * so a seeded campaign's snapshot matches what a campaign created through the
 * dashboard on the same day would have snapshotted.
 */
const ALLOCATION = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'web', 'src', 'server', 'config', 'economics.json'), 'utf8'),
).allocation as { reward: number; platform: number; treasury: number };

/**
 * Artwork is served by the web app, so the extension — a different origin —
 * needs these absolute. The chat webview's CSP allows `https:`, so a deployed
 * APP_URL works; locally the webview and the app share `http://localhost`.
 *
 * `--app-url=` overrides the env var because the two are routinely mismatched:
 * seeding the hosted database is done from a checkout whose `.env` points
 * NEXT_PUBLIC_APP_URL at localhost, and taking that literally would write image
 * URLs no deployed client can reach.
 */
const APP_URL = (
  process.argv.find((a) => a.startsWith('--app-url='))?.slice('--app-url='.length) ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3001'
).replace(/\/$/, '');
const art = (file: string) => `${APP_URL}/creatives/brands/${file}.svg`;

// A localhost image URL in a database nobody is reading from localhost is the
// one mistake here that does not announce itself: the card renders, the artwork
// silently 404s, and AdCard falls back to the advertiser's initial.
const seedingRemoteDb = !/(localhost|127\.0\.0\.1)/.test(connectionString);
if (seedingRemoteDb && /(localhost|127\.0\.0\.1)/.test(APP_URL)) {
  console.warn(
    `warning: seeding a remote database with artwork at ${APP_URL}.\n` +
      `         Clients will not be able to load it. Pass --app-url=https://your-deployment to fix.\n`,
  );
}

/**
 * Looser than production on purpose. The real cap of one card per campaign per
 * hour makes a demo look broken — ask two questions about Postgres and the
 * second returns nothing. The mechanism is untouched; only these numbers are
 * generous.
 */
const DEMO_FREQUENCY_CAP = { perUserPerHour: 5, perUserPerDay: 25 };

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const IN_90_DAYS = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

/** Empty targeting is the shape `isUntargeted` recognises; every key still has to be present. */
const NO_TARGETING = {
  countries: [] as string[],
  personas: [] as string[],
  interests: [] as string[],
  technologies: [] as string[],
  intentCategories: [] as string[],
  aiIntents: [] as string[],
  models: [] as string[],
  minCommercialIntent: 'low',
  onchainMode: 'off' as const,
  onchainCriteria: {},
};

interface BrandSpec {
  slug: string;
  /** What the card prints as the sponsor. The real product name, which is the point. */
  name: string;
  website: string;
  campaigns: CampaignSpec[];
}

interface CampaignSpec {
  name: string;
  budget: bigint;
  /** What one qualified banner impression costs. The inline slot is scaled from it. */
  bid: bigint;
  targeting: typeof NO_TARGETING;
  banner: {
    headline: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
    image: string | null;
  };
  inline: { headline: string; ctaText: string; ctaUrl: string };
}

/**
 * Countries are empty everywhere and personas are empty everywhere, because
 * both are hard filters: a developer whose country we could not resolve, or
 * whose persona the classifier did not commit to, would be ineligible for every
 * card rather than for a badly-matched one.
 */
const BRANDS: BrandSpec[] = [
  {
    slug: 'supabase',
    name: 'Supabase',
    website: 'https://supabase.com',
    campaigns: [
      {
        name: 'Postgres for app developers',
        budget: USD(750),
        bid: USD(0.012),
        targeting: {
          ...NO_TARGETING,
          interests: ['devtools', 'startups'],
          technologies: ['postgres', 'supabase', 'prisma', 'nextjs', 'typescript', 'node'],
          intentCategories: ['data', 'development'],
          aiIntents: ['database_design', 'backend_api_development', 'auth_integration'],
        },
        banner: {
          headline: 'Postgres with auth, storage and realtime built in',
          body: 'A dedicated Postgres database behind one client library, with row level security, file storage, edge functions and realtime subscriptions. The free plan covers 500 MB of database and 50,000 monthly active users.',
          ctaText: 'Start a free project',
          ctaUrl: 'https://supabase.com/dashboard/sign-up',
          image: art('supabase-wide'),
        },
        inline: {
          headline: 'Free Postgres with auth and storage attached',
          ctaText: 'Start a project',
          ctaUrl: 'https://supabase.com/dashboard/sign-up',
        },
      },
    ],
  },
  {
    slug: 'neon',
    name: 'Neon',
    website: 'https://neon.com',
    campaigns: [
      {
        name: 'Database branching for CI',
        budget: USD(400),
        bid: USD(0.01),
        targeting: {
          ...NO_TARGETING,
          interests: ['devtools', 'infrastructure'],
          technologies: ['postgres', 'prisma', 'node', 'typescript', 'vercel'],
          intentCategories: ['data'],
          aiIntents: ['database_design', 'testing', 'backend_api_development'],
          // Someone comparing Postgres hosts is closer to a decision than
          // someone asking what a foreign key is, and only the first is worth
          // the slot to this campaign.
          minCommercialIntent: 'medium',
        },
        banner: {
          headline: 'Branch your Postgres the way you branch your code',
          body: 'Serverless Postgres that autoscales and scales to zero, with an instant isolated branch for every pull request. The free plan gives 0.5 GB of storage and 100 compute hours per project.',
          ctaText: 'Create a free database',
          ctaUrl: 'https://neon.com',
          image: art('neon'),
        },
        inline: {
          headline: 'A fresh Postgres branch for every pull request',
          ctaText: 'Try Neon free',
          ctaUrl: 'https://neon.com',
        },
      },
    ],
  },
  {
    slug: 'clerk',
    name: 'Clerk',
    website: 'https://clerk.com',
    campaigns: [
      {
        name: 'Auth for React and Next.js',
        budget: USD(600),
        bid: USD(0.014),
        targeting: {
          ...NO_TARGETING,
          interests: ['devtools', 'startups', 'security'],
          technologies: ['nextjs', 'react', 'typescript', 'node', 'express'],
          intentCategories: ['development', 'security'],
          aiIntents: ['auth_integration', 'frontend_development', 'backend_api_development'],
        },
        banner: {
          headline: 'Sign-in, sign-up and user management in a few lines',
          body: 'Prebuilt components, session handling, multi-factor auth and passkeys for React and Next.js, with organisations and roles included. Free to 50,000 monthly retained users, no card required.',
          ctaText: 'Read the Next.js quickstart',
          ctaUrl: 'https://clerk.com/docs/quickstarts/nextjs',
          image: art('clerk'),
        },
        inline: {
          headline: 'Drop-in auth for Next.js, free to 50k users',
          ctaText: 'See the docs',
          ctaUrl: 'https://clerk.com/docs/quickstarts/nextjs',
        },
      },
    ],
  },
  {
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    website: 'https://elevenlabs.io',
    campaigns: [
      {
        name: 'Voice APIs for agent builders',
        budget: USD(500),
        bid: USD(0.011),
        targeting: {
          ...NO_TARGETING,
          interests: ['ai', 'devtools'],
          technologies: ['openai', 'anthropic', 'langchain', 'python', 'typescript', 'node'],
          intentCategories: ['development'],
          aiIntents: ['ai_ml_integration', 'backend_api_development', 'onchain_agent_development'],
        },
        banner: {
          headline: 'Give your agent a voice with one API call',
          body: 'Text to speech across 70+ languages, Scribe speech to text across 90+, and a realtime speech engine for conversational agents. The Flash model returns audio in roughly 75 ms.',
          ctaText: 'Open the API docs',
          ctaUrl: 'https://elevenlabs.io/docs',
          image: art('elevenlabs-wide'),
        },
        inline: {
          headline: 'Realtime text to speech in 70+ languages',
          ctaText: 'See the API',
          ctaUrl: 'https://elevenlabs.io/docs',
        },
      },
    ],
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    website: 'https://vercel.com',
    campaigns: [
      {
        name: 'Preview deployments for every push',
        budget: USD(900),
        bid: USD(0.015),
        targeting: {
          ...NO_TARGETING,
          interests: ['devtools', 'infrastructure'],
          technologies: ['nextjs', 'react', 'vercel', 'typescript', 'svelte', 'vue'],
          intentCategories: ['infrastructure', 'development'],
          aiIntents: ['devops_deployment', 'frontend_development', 'performance_optimization'],
        },
        banner: {
          headline: 'Every push gets its own preview deployment',
          body: 'Git-connected builds, a preview URL for each pull request, and a global edge network with automatic routing. Hobby is free for personal projects; Pro is $20 per seat per month.',
          ctaText: 'Deploy your project',
          ctaUrl: 'https://vercel.com/new',
          image: art('vercel-wide'),
        },
        inline: {
          headline: 'A preview URL for every pull request',
          ctaText: 'Deploy free',
          ctaUrl: 'https://vercel.com/new',
        },
      },
    ],
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    website: 'https://sentry.io',
    campaigns: [
      {
        name: 'Error monitoring for shipping teams',
        budget: USD(550),
        bid: USD(0.013),
        targeting: {
          ...NO_TARGETING,
          interests: ['devtools', 'infrastructure'],
          technologies: ['react', 'nextjs', 'node', 'python', 'typescript', 'go'],
          intentCategories: ['debugging', 'infrastructure'],
          aiIntents: ['bug_fixing', 'observability_monitoring', 'performance_optimization'],
        },
        banner: {
          headline: 'See the stack trace before the bug report arrives',
          body: 'Error monitoring, tracing, session replay, logs and profiling across your stack, with the failing line and the release that introduced it. The free Developer plan covers 5,000 errors, 5M spans and 50 replays a month.',
          ctaText: 'Start free',
          ctaUrl: 'https://sentry.io/signup/',
          image: art('sentry'),
        },
        inline: {
          headline: 'Catch the exception before the bug report does',
          ctaText: 'Start free',
          ctaUrl: 'https://sentry.io/signup/',
        },
      },
    ],
  },
  {
    slug: 'hostinger',
    name: 'Hostinger',
    website: 'https://www.hostinger.com',
    campaigns: [
      {
        name: 'VPS for self-hosted stacks',
        budget: USD(350),
        bid: USD(0.009),
        targeting: {
          ...NO_TARGETING,
          interests: ['infrastructure', 'devtools'],
          technologies: ['docker', 'kubernetes', 'node', 'postgres', 'redis'],
          intentCategories: ['infrastructure'],
          aiIntents: ['cloud_infrastructure', 'devops_deployment', 'node_operations'],
          minCommercialIntent: 'medium',
        },
        banner: {
          headline: 'A KVM VPS with root access and NVMe storage',
          body: 'The entry KVM plan carries 1 vCPU, 4 GB of RAM, 50 GB of NVMe disk and 4 TB of bandwidth, with one-click templates for Docker, n8n, GitLab and Ubuntu. Backed by a 30-day money-back guarantee.',
          ctaText: 'Compare VPS plans',
          ctaUrl: 'https://www.hostinger.com/vps-hosting',
          image: art('hostinger'),
        },
        inline: {
          headline: 'KVM VPS: 4 GB RAM, NVMe, full root access',
          ctaText: 'Compare plans',
          ctaUrl: 'https://www.hostinger.com/vps-hosting',
        },
      },
      {
        // The remnant. Nothing is targeted, which is what makes it eligible to
        // fill a slot no relevant campaign wanted — and its low bid is what
        // stops it outbidding a relevant campaign that did.
        name: 'Brand — unsold slot',
        budget: USD(250),
        bid: USD(0.004),
        targeting: { ...NO_TARGETING },
        banner: {
          headline: 'Hosting that stays out of the way of the build',
          body: 'Web hosting, VPS and managed cloud from a single panel, with one-click installs for the stacks you already run and a 30-day money-back guarantee on every plan.',
          ctaText: 'Explore Hostinger',
          ctaUrl: 'https://www.hostinger.com',
          image: art('hostinger'),
        },
        inline: {
          headline: 'Developer hosting, managed from one panel',
          ctaText: 'Explore Hostinger',
          ctaUrl: 'https://www.hostinger.com',
        },
      },
    ],
  },
  {
    slug: 'alchemy',
    name: 'Alchemy',
    website: 'https://www.alchemy.com',
    campaigns: [
      {
        name: 'RPC and onchain data',
        budget: USD(800),
        bid: USD(0.016),
        targeting: {
          ...NO_TARGETING,
          interests: ['web3', 'infrastructure', 'defi'],
          technologies: [
            'ethereum',
            'base',
            'arbitrum',
            'optimism',
            'polygon',
            'solana',
            'viem',
            'ethers',
            'wagmi',
            'solidity',
          ],
          intentCategories: ['infrastructure', 'data'],
          aiIntents: [
            'rpc_infrastructure_evaluation',
            'indexing_querying_onchain_data',
            'smart_contract_deployment',
            'frontend_dapp_development',
          ],
          // `boost` rather than `require`: a wallet with real mainnet history
          // scores this campaign higher, but a developer who has not linked one
          // is still shown it. `require` here would make the campaign invisible
          // until the onchain demo has been run, which is the wrong order.
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
        banner: {
          headline: 'One RPC endpoint for every chain you ship on',
          body: 'Node APIs across Ethereum, Base, Arbitrum, Optimism, Polygon and Solana, plus Token, Transfers, Prices and NFT data APIs and a multi-chain sandbox. The free plan includes 30M compute units a month.',
          ctaText: 'Get an API key',
          ctaUrl: 'https://www.alchemy.com',
          image: art('alchemy'),
        },
        inline: {
          headline: 'One RPC endpoint for Ethereum, Base and Solana',
          ctaText: 'Get an API key',
          ctaUrl: 'https://www.alchemy.com',
        },
      },
    ],
  },
];

let created = 0;
let refreshed = 0;

for (const brand of BRANDS) {
  const subject = `seed:brand-${brand.slug}`;

  const user = await prisma.user.upsert({
    where: { subject },
    update: {},
    create: {
      subject,
      // No email. Inventing `ads@<company>.com` would put a plausible but
      // unowned contact address for a real company into the database.
      displayName: `${brand.name} (demo advertiser)`,
      roles: ['user', 'advertiser'],
      profile: { create: {} },
    },
  });

  // Neither organisations nor advertisers carry a natural unique key, so
  // idempotency is a lookup on the owner and the name rather than an upsert.
  const org =
    (await prisma.organization.findFirst({
      where: { ownerUserId: user.id, name: brand.name },
    })) ?? (await prisma.organization.create({ data: { name: brand.name, ownerUserId: user.id } }));

  const advertiser =
    (await prisma.advertiser.findFirst({ where: { orgId: org.id, name: brand.name } })) ??
    (await prisma.advertiser.create({
      data: { orgId: org.id, userId: user.id, name: brand.name, website: brand.website },
    }));

  for (const spec of brand.campaigns) {
    const existing = await prisma.campaign.findFirst({
      where: { advertiserId: advertiser.id, name: spec.name },
    });

    // Budget, spend and status of an existing campaign are left exactly as they
    // are: re-running this to fix a typo in a headline must not refill a budget
    // that was spent or restart a campaign someone deliberately paused.
    const campaign =
      existing ??
      (await prisma.campaign.create({
        data: {
          advertiserId: advertiser.id,
          name: spec.name,
          status: 'active',
          budgetMicro: spec.budget,
          bidMicro: spec.bid,
          clickMultiplier: 3,
          allocation: ALLOCATION,
          frequencyCap: DEMO_FREQUENCY_CAP,
          startsAt: YESTERDAY,
          endsAt: IN_90_DAYS,
        },
      }));

    await prisma.campaignTargeting.upsert({
      where: { campaignId: campaign.id },
      create: { campaignId: campaign.id, ...spec.targeting },
      update: spec.targeting,
    });

    await prisma.adCreative.upsert({
      where: { campaignId_format: { campaignId: campaign.id, format: 'banner' } },
      create: {
        campaignId: campaign.id,
        format: 'banner',
        headline: spec.banner.headline,
        body: spec.banner.body,
        ctaText: spec.banner.ctaText,
        ctaUrl: spec.banner.ctaUrl,
        imageUrl: spec.banner.image,
      },
      update: {
        headline: spec.banner.headline,
        body: spec.banner.body,
        ctaText: spec.banner.ctaText,
        ctaUrl: spec.banner.ctaUrl,
        imageUrl: spec.banner.image,
      },
    });

    // An inline creative is the whole ad on one line, so it carries no body and
    // no artwork — the columns exist for the banner.
    await prisma.adCreative.upsert({
      where: { campaignId_format: { campaignId: campaign.id, format: 'inline' } },
      create: {
        campaignId: campaign.id,
        format: 'inline',
        headline: spec.inline.headline,
        body: null,
        ctaText: spec.inline.ctaText,
        ctaUrl: spec.inline.ctaUrl,
        imageUrl: null,
      },
      update: {
        headline: spec.inline.headline,
        body: null,
        ctaText: spec.inline.ctaText,
        ctaUrl: spec.inline.ctaUrl,
        imageUrl: null,
      },
    });

    if (existing) {
      refreshed += 1;
      console.log(`  refreshed ${brand.name} — ${spec.name} [${existing.status}]`);
    } else {
      created += 1;
      console.log(`  created   ${brand.name} — ${spec.name} [active]`);
    }
  }
}

console.log(
  `\ndone: ${created} campaign(s) created, ${refreshed} refreshed, across ${BRANDS.length} advertisers.` +
    `\nartwork is served from ${APP_URL}/creatives/brands/ — the web app has to be reachable there for cards to show it.`,
);

await prisma.$disconnect();
