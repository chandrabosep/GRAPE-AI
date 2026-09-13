import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../test/db';

/**
 * The funding gate: a campaign cannot be launched on money that is not there.
 *
 * This lives in its own file because it needs the vault *configured*, and the
 * rest of the campaign suite deliberately runs without one — on a deployment
 * with no contracts the readiness check has to let campaigns launch, or a
 * missing address turns into a dead application rather than a missing feature.
 * Setting the address here would make every activation in that file fail.
 *
 * The RPC points at a closed port on purpose. What is being asserted is that
 * the gate **fails closed**: when the vault's deposit cannot be confirmed, the
 * campaign does not launch. Reaching real Hedera to prove that would make the
 * suite slow, flaky and dependent on somebody else's uptime.
 */

let database: TestDatabase;
type Modules = {
  prisma: typeof import('@aam/db').prisma;
  advertisers: typeof import('./modules/advertisers/service');
  campaigns: typeof import('./modules/campaigns/service');
  funding: typeof import('./modules/campaigns/funding');
};
let m: Modules;

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.connectionString;
  process.env.DIRECT_URL = database.connectionString;

  // Set before the first `env()` call, which caches. A deployed vault, and an
  // RPC that refuses instantly rather than hanging the suite.
  process.env.CAMPAIGN_VAULT_ADDRESS = '0x4F160b39EbB23DBA8650f50aD5fc95964e085c42';
  process.env.RPC_URL = 'http://127.0.0.1:1';

  m = {
    prisma: (await import('@aam/db')).prisma,
    advertisers: await import('./modules/advertisers/service'),
    campaigns: await import('./modules/campaigns/service'),
    funding: await import('./modules/campaigns/funding'),
  };
}, 60_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await database?.stop();
});

async function fundableCampaign(name: string) {
  const user = await m.prisma.user.create({
    data: { subject: `test:${name}-${Date.now()}-${Math.random()}` },
  });
  const advertiser = await m.advertisers.createAdvertiser({ userId: user.id, companyName: name });

  const campaign = await m.campaigns.createCampaign(advertiser.id, {
    name: `${name} launch`,
    budgetMicro: 100_000_000n,
    bidMicro: 10_000n,
    clickMultiplier: 3,
    startsAt: PAST,
    endsAt: FUTURE,
    frequencyCap: { perUserPerHour: 1, perUserPerDay: 3 },
  });

  // Everything the readiness check wants apart from the money, so a refusal
  // can only be about funding.
  await m.campaigns.updateTargeting(campaign.id, advertiser.id, {
    countries: [],
    personas: [],
    interests: [],
    technologies: [],
    intentCategories: [],
    aiIntents: [],
    models: [],
    minCommercialIntent: 'low',
    onchainMode: 'off',
    onchainCriteria: {
      requireWalletActivity: false,
      protocolTypes: [],
      protocols: [],
      activityWindowDays: 30,
      requireEnsHolder: false,
      requireStablecoinHolder: false,
      requireNftHolder: false,
      chains: ['mainnet'],
    },
  });

  await m.campaigns.upsertCreative(campaign.id, advertiser.id, {
    format: 'banner',
    headline: 'Ship faster',
    body: 'Managed nodes.',
    ctaText: 'Try it',
    ctaUrl: 'https://example.com',
    imageUrl: null,
  });

  return { advertiser, campaign };
}

describe('campaign funding gate', () => {
  it('refuses to launch a campaign whose budget is not in the vault', async () => {
    const { advertiser, campaign } = await fundableCampaign('Unfunded Co');

    const readiness = await m.campaigns.checkReadyToRun(campaign.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/fund/i);

    await m.campaigns.transition(campaign.id, advertiser.id, 'awaiting_funding');
    await expect(
      m.campaigns.transition(campaign.id, advertiser.id, 'active'),
    ).rejects.toThrow(/fund/i);

    // And it really did not launch — a refusal that still flipped the row
    // would be worse than no gate at all.
    const after = await m.prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(after.status).toBe('awaiting_funding');
  });

  it('reports nothing deposited when the vault cannot be reached', async () => {
    const { advertiser, campaign } = await fundableCampaign('Offline RPC Co');

    const state = await m.funding.fundingState(campaign.id, advertiser.id);

    expect(state.configured).toBe(true);
    expect(state.depositedMicro).toBe(0n);
    expect(state.outstandingMicro).toBe(100_000_000n);
    expect(state.funded).toBe(false);
  });

  it('derives the same vault key for a campaign every time', () => {
    const key = m.funding.vaultKeyFor('0192f3a1-0000-7000-8000-000000000000');

    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(m.funding.vaultKeyFor('0192f3a1-0000-7000-8000-000000000000')).toBe(key);
    expect(m.funding.vaultKeyFor('0192f3a1-0000-7000-8000-000000000001')).not.toBe(key);
  });

  it('refuses to read a campaign belonging to someone else', async () => {
    const { campaign } = await fundableCampaign('Owner Co');
    const { advertiser: stranger } = await fundableCampaign('Stranger Co');

    await expect(m.funding.fundingState(campaign.id, stranger.id)).rejects.toThrow(/not found/i);
  });
});
