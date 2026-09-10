import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../test/db';

/**
 * Campaign lifecycle and, more importantly, isolation between advertisers.
 *
 * The authorisation assertions here are the ones that matter: an advertiser
 * must not be able to read, edit or control a campaign that is not theirs, and
 * must not be able to tell the difference between "does not exist" and "belongs
 * to someone else".
 */

let database: TestDatabase;
type Modules = {
  prisma: typeof import('@aam/db').prisma;
  advertisers: typeof import('./modules/advertisers/service');
  campaigns: typeof import('./modules/campaigns/service');
};
let m: Modules;

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

async function makeAdvertiser(name: string) {
  const user = await m.prisma.user.create({
    data: { subject: `test:${name}-${Date.now()}-${Math.random()}` },
  });
  return m.advertisers.createAdvertiser({ userId: user.id, companyName: name });
}

const validCampaign = {
  name: 'Ethereum Developer Launch',
  budgetMicro: 100_000_000n,
  bidMicro: 10_000n,
  clickMultiplier: 3,
  startsAt: PAST,
  endsAt: FUTURE,
  frequencyCap: { perUserPerHour: 1, perUserPerDay: 3 },
};

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.connectionString;
  process.env.DIRECT_URL = database.connectionString;

  m = {
    prisma: (await import('@aam/db')).prisma,
    advertisers: await import('./modules/advertisers/service'),
    campaigns: await import('./modules/campaigns/service'),
  };
}, 60_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await database?.stop();
});

describe('campaign lifecycle', () => {
  it('snapshots the allocation split when the campaign is created', async () => {
    const advertiser = await makeAdvertiser('Northwind RPC');
    const campaign = await m.campaigns.createCampaign(advertiser.id, validCampaign);

    expect(campaign.status).toBe('draft');
    expect(campaign.allocation).toEqual({ reward: 0.7, platform: 0.2, treasury: 0.1 });
  });

  it('rejects a bid larger than the budget', async () => {
    const advertiser = await makeAdvertiser('Bad Maths Inc');
    await expect(
      m.campaigns.createCampaign(advertiser.id, {
        ...validCampaign,
        budgetMicro: 1_000n,
        bidMicro: 5_000n,
      }),
    ).rejects.toThrow(/Bid cannot exceed/);
  });

  it('rejects a campaign that ends before it starts', async () => {
    const advertiser = await makeAdvertiser('Time Traveller');
    await expect(
      m.campaigns.createCampaign(advertiser.id, {
        ...validCampaign,
        startsAt: FUTURE,
        endsAt: PAST,
      }),
    ).rejects.toThrow(/must end after/);
  });

  it('refuses to launch a campaign with no creative', async () => {
    const advertiser = await makeAdvertiser('No Creative Co');
    const campaign = await m.campaigns.createCampaign(advertiser.id, validCampaign);

    await m.campaigns.transition(campaign.id, advertiser.id, 'awaiting_funding');
    await expect(
      m.campaigns.transition(campaign.id, advertiser.id, 'active'),
    ).rejects.toThrow(/creative/);
  });

  it('launches once targeting and a creative are in place', async () => {
    const advertiser = await makeAdvertiser('Ready Co');
    const campaign = await m.campaigns.createCampaign(advertiser.id, validCampaign);

    await m.campaigns.updateTargeting(campaign.id, advertiser.id, {
      countries: ['IN'],
      personas: ['web3_developer'],
      interests: ['web3'],
      technologies: ['solidity'],
      intentCategories: ['infrastructure'],
      aiIntents: ['smart_contract_deployment'],
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
      headline: 'Ship your contract faster',
      body: 'Managed Ethereum RPC with archive access.',
      ctaText: 'Learn more',
      ctaUrl: 'https://example.com',
    });

    await m.campaigns.transition(campaign.id, advertiser.id, 'awaiting_funding');
    const active = await m.campaigns.transition(campaign.id, advertiser.id, 'active');
    expect(active.status).toBe('active');
  });

  it('refuses an illegal status move rather than ignoring it', async () => {
    const advertiser = await makeAdvertiser('Illegal Moves Ltd');
    const campaign = await m.campaigns.createCampaign(advertiser.id, validCampaign);

    // draft -> paused is not a thing.
    await expect(
      m.campaigns.transition(campaign.id, advertiser.id, 'paused'),
    ).rejects.toThrow(/cannot become/);
  });

  it('never reopens an ended campaign', async () => {
    const advertiser = await makeAdvertiser('Finished Co');
    const campaign = await m.campaigns.createCampaign(advertiser.id, validCampaign);
    await m.campaigns.transition(campaign.id, advertiser.id, 'ended');

    await expect(
      m.campaigns.transition(campaign.id, advertiser.id, 'active'),
    ).rejects.toThrow(/cannot become/);
  });
});

describe('advertiser isolation', () => {
  it('hides another advertiser\'s campaign as if it did not exist', async () => {
    const owner = await makeAdvertiser('Owner Co');
    const stranger = await makeAdvertiser('Stranger Co');
    const campaign = await m.campaigns.createCampaign(owner.id, validCampaign);

    // Same error as a genuinely missing id: existence must not leak.
    await expect(m.campaigns.getCampaign(campaign.id, stranger.id)).rejects.toThrow(
      /Campaign not found/,
    );
    await expect(
      m.campaigns.getCampaign('01a00000-0000-7000-8000-000000000000', stranger.id),
    ).rejects.toThrow(/Campaign not found/);
  });

  it('refuses edits and status changes from another advertiser', async () => {
    const owner = await makeAdvertiser('Owner Two');
    const stranger = await makeAdvertiser('Stranger Two');
    const campaign = await m.campaigns.createCampaign(owner.id, validCampaign);

    await expect(
      m.campaigns.upsertCreative(campaign.id, stranger.id, {
        headline: 'Hijacked headline',
        body: 'Should never be written.',
        ctaText: 'No',
        ctaUrl: 'https://example.com',
      }),
    ).rejects.toThrow(/not found/);

    await expect(
      m.campaigns.transition(campaign.id, stranger.id, 'ended'),
    ).rejects.toThrow(/not found/);

    const untouched = await m.campaigns.getCampaign(campaign.id, owner.id);
    expect(untouched.creatives).toHaveLength(0);
    expect(untouched.status).toBe('draft');
  });

  it('scopes the overview to the advertiser\'s own campaigns', async () => {
    const a = await makeAdvertiser('Metrics A');
    const b = await makeAdvertiser('Metrics B');
    await m.campaigns.createCampaign(a.id, validCampaign);
    await m.campaigns.createCampaign(a.id, { ...validCampaign, name: 'Second' });
    await m.campaigns.createCampaign(b.id, validCampaign);

    expect((await m.advertisers.advertiserOverview(a.id)).campaignCount).toBe(2);
    expect((await m.advertisers.advertiserOverview(b.id)).campaignCount).toBe(1);
  });
});

describe('audience estimation', () => {
  it('suppresses counts below the reporting floor', async () => {
    const estimate = await m.campaigns.estimateAudience({
      countries: ['ZZ'],
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

    expect(estimate.suppressed).toBe(true);
    expect(estimate.byPersona).toEqual({});
  });
});
