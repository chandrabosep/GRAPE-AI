import { FakeProvider } from '@aam/ai-provider';
import { createSSEParser, type ChatStreamEvent } from '@aam/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../test/db';

/**
 * The circular economy, end to end, against a real database.
 *
 * Advertiser budget -> relevant ad chosen for a real intent -> confirmed
 * attention -> credits in the developer's balance -> those credits paying for
 * the next request. If this passes, the product thesis works in code.
 *
 * Modules are imported dynamically because the Prisma client reads
 * DATABASE_URL when it is first constructed, which must happen after the test
 * database is up.
 */

let database: TestDatabase;
type Modules = {
  prisma: typeof import('@aam/db').prisma;
  chat: typeof import('./modules/ai/chat');
  provider: typeof import('./modules/ai/provider');
  users: typeof import('./modules/users/service');
  credits: typeof import('./modules/credits/service');
  rewards: typeof import('./modules/rewards/service');
};
let m: Modules;

let advertiserSeq = 0;

interface SeedOptions {
  name?: string;
  /** Which sponsored slots this campaign competes for. */
  formats?: ('banner' | 'inline')[];
}

async function seedCampaign(prisma: Modules['prisma'], options: SeedOptions = {}) {
  const name = options.name ?? 'Northwind RPC';
  const formats = options.formats ?? ['banner'];
  const unique = `${Date.now()}-${advertiserSeq++}`;

  const advertiserUser = await prisma.user.create({
    data: { subject: `test:adv-${unique}`, roles: ['user', 'advertiser'] },
  });
  const org = await prisma.organization.create({
    data: { name, ownerUserId: advertiserUser.id },
  });
  const advertiser = await prisma.advertiser.create({
    data: { orgId: org.id, userId: advertiserUser.id, name },
  });

  const campaign = await prisma.campaign.create({
    data: {
      advertiserId: advertiser.id,
      name: `${name} — Ethereum Developer Launch`,
      status: 'active',
      budgetMicro: 100_000_000n,
      bidMicro: 10_000n,
      allocation: { reward: 0.7, platform: 0.2, treasury: 0.1 },
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
      frequencyCap: { perUserPerHour: 5, perUserPerDay: 20 },
    },
  });

  await prisma.campaignTargeting.create({
    data: {
      campaignId: campaign.id,
      personas: ['web3_developer'],
      technologies: ['solidity', 'foundry', 'ethereum'],
      aiIntents: ['smart_contract_deployment'],
      intentCategories: ['infrastructure'],
      minCommercialIntent: 'low',
      onchainMode: 'off',
      onchainCriteria: {},
    },
  });

  for (const format of formats) {
    await prisma.adCreative.create({
      data: {
        campaignId: campaign.id,
        format,
        headline:
          format === 'banner'
            ? 'Ship your contract without babysitting a node'
            : 'Managed Ethereum RPC, archive access included',
        body: format === 'banner' ? 'Managed Ethereum RPC with archive access.' : null,
        ctaText: format === 'banner' ? 'See the free tier' : 'Free tier',
        ctaUrl: 'https://example.com/northwind',
      },
    });
  }

  return campaign;
}

async function collectStream(response: Response): Promise<ChatStreamEvent[]> {
  const parser = createSSEParser();
  const events: ChatStreamEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  return events;
}

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.connectionString;
  process.env.DIRECT_URL = database.connectionString;
  process.env.AI_PROVIDER = 'fake';

  m = {
    prisma: (await import('@aam/db')).prisma,
    chat: await import('./modules/ai/chat'),
    provider: await import('./modules/ai/provider'),
    users: await import('./modules/users/service'),
    credits: await import('./modules/credits/service'),
    rewards: await import('./modules/rewards/service'),
  };

  m.provider.setAIProvider(new FakeProvider({ chunkSize: 40 }));
}, 60_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await database?.stop();
});

describe('the credit loop', () => {
  it('turns advertiser budget into credits that pay for the next request', async () => {
    const campaign = await seedCampaign(m.prisma);

    const user = await m.users.upsertFromIdentity({
      subject: `test:dev-${Date.now()}`,
      email: 'dev@example.com',
    });

    // A new user starts with the grant that breaks the cold-start loop.
    const startingBalance = await m.credits.getBalance(user.id);
    expect(startingBalance).toBeGreaterThan(0n);

    const response = m.chat.handleChat(
      {
        messages: [
          { role: 'user', content: 'How do I deploy this Solidity contract using Foundry?' },
        ],
        hints: { languageId: 'solidity' },
        useCredits: true,
        tools: false,
      },
      {
        user,
        sessionId: null,
        client: 'web',
        requestId: `req_${Date.now()}`,
        adsEnabled: true,
      },
    );

    const events = await collectStream(response);
    const types = events.map((e) => e.type);

    expect(types).toContain('start');
    expect(types).toContain('intent');
    expect(types).toContain('delta');
    expect(types).toContain('done');

    // The classifier understood the request.
    const intentEvent = events.find((e) => e.type === 'intent');
    expect(intentEvent?.intent.intent).toBe('smart_contract_deployment');

    // A relevant ad was chosen, and it is the campaign that targeted this intent.
    const adEvent = events.find((e) => e.type === 'ad');
    expect(adEvent, 'expected a sponsored card for a matching campaign').toBeDefined();
    expect(adEvent!.ad.headline).toContain('Ship your contract');
    expect(adEvent!.ad.reasons).toEqual(
      expect.arrayContaining(['smart_contract_deployment', 'solidity']),
    );

    // Inference was charged against the balance.
    const usageEvent = events.find((e) => e.type === 'usage');
    expect(usageEvent!.usage.totalTokens).toBeGreaterThan(0);
    const afterInference = await m.credits.getBalance(user.id);
    expect(afterInference).toBeLessThan(startingBalance);

    // The advertiser was charged for the impression.
    const chargedCampaign = await m.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(chargedCampaign.spentMicro).toBe(10_000n);

    // Confirming the ad was on screen pays the developer their 70% share.
    const outcome = await m.rewards.confirmImpression(user.id, adEvent!.ad.impressionId, 1_500);
    expect(outcome.granted).toBe(true);
    expect(outcome.amountMicro).toBe(7_000n);

    const afterReward = await m.credits.getBalance(user.id);
    expect(afterReward).toBe(afterInference + 7_000n);

    // The split is exact: nothing created, nothing lost.
    const reward = await m.prisma.reward.findFirstOrThrow({ where: { userId: user.id } });
    expect(reward.amountMicro + reward.platformMicro + reward.treasuryMicro).toBe(
      reward.chargeMicro,
    );
  }, 60_000);

  it('refuses to pay twice for the same impression', async () => {
    const impression = await m.prisma.adImpression.findFirstOrThrow({
      where: { qualified: true },
      orderBy: { createdAt: 'desc' },
    });

    const outcome = await m.rewards.confirmImpression(impression.userId, impression.id, 5_000);
    expect(outcome.granted).toBe(false);
    expect(outcome.reason).toBe('already_rewarded');
  });

  it('records derived intent but never the prompt itself', async () => {
    const intents = await m.prisma.aiIntentRecord.findMany();
    expect(intents.length).toBeGreaterThan(0);

    // The prompt used above must not be reconstructable from anything stored.
    const serialised = JSON.stringify(intents);
    expect(serialised).not.toContain('Foundry');
    expect(serialised).not.toContain('deploy this');

    const record = intents[0]!;
    expect(record.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.intent).toBe('smart_contract_deployment');
  });

  /**
   * The two-slot answer, end to end.
   *
   * Three things have to hold at once and none of them is obvious: the slots
   * are priced differently, they come from different advertisers, and both of
   * them pay. The last one is the easiest to break — the anti-farming rule
   * spaces rewards a minute apart, and two slots of one answer arrive together.
   */
  it('fills both sponsored slots from different advertisers, and pays for both', async () => {
    await seedCampaign(m.prisma, { name: 'Inline Co', formats: ['inline'] });
    await seedCampaign(m.prisma, { name: 'Banner Co', formats: ['banner'] });

    const user = await m.users.upsertFromIdentity({
      subject: `test:dev-two-slots-${Date.now()}`,
    });

    const events = await collectStream(
      m.chat.handleChat(
        {
          messages: [
            { role: 'user', content: 'How do I deploy this Solidity contract using Foundry?' },
          ],
          hints: { languageId: 'solidity' },
          useCredits: true,
          tools: false,
        },
        {
          user,
          sessionId: null,
          client: 'web',
          requestId: `req_two_slots_${Date.now()}`,
          adsEnabled: true,
        },
      ),
    );

    const ads = events.filter((e) => e.type === 'ad').map((e) => e.ad);
    expect(ads).toHaveLength(2);

    const inline = ads.find((ad) => ad.format === 'inline');
    const banner = ads.find((ad) => ad.format === 'banner');
    expect(inline).toBeDefined();
    expect(banner).toBeDefined();

    // One answer never carries the same advertiser twice.
    expect(inline!.advertiserName).not.toBe(banner!.advertiserName);

    // An inline creative is one line: it has no body to render.
    expect(inline!.body).toBeNull();
    expect(banner!.body).toBeTruthy();

    // Both campaigns bid 10_000µ. The inline slot bills at 30% of that, so the
    // reward it offers is 70% of 3_000µ rather than 70% of 10_000µ.
    expect(banner!.estimatedRewardMicro).toBe(7_000);
    expect(inline!.estimatedRewardMicro).toBe(2_100);

    const before = await m.credits.getBalance(user.id);

    const bannerOutcome = await m.rewards.confirmImpression(
      user.id,
      banner!.impressionId,
      1_500,
    );
    const inlineOutcome = await m.rewards.confirmImpression(
      user.id,
      inline!.impressionId,
      1_500,
    );

    // The second slot must not be refused as "too_soon": the spacing rule is
    // about repeated prompts, and these two are the same answer.
    expect(bannerOutcome.granted).toBe(true);
    expect(inlineOutcome.granted).toBe(true);
    expect(inlineOutcome.reason).toBeUndefined();

    const after = await m.credits.getBalance(user.id);
    expect(after - before).toBe(7_000n + 2_100n);

    // Neither advertiser was charged more than the slot they actually won.
    const impressions = await m.prisma.adImpression.findMany({
      where: { id: { in: [banner!.impressionId, inline!.impressionId] } },
      select: { format: true, chargedMicro: true },
    });
    expect(
      impressions.find((i) => i.format === 'banner')?.chargedMicro,
    ).toBe(10_000n);
    expect(
      impressions.find((i) => i.format === 'inline')?.chargedMicro,
    ).toBe(3_000n);
  }, 60_000);

  it('keeps the credit ledger append-only at the database level', async () => {
    const entry = await m.prisma.creditTransaction.findFirstOrThrow();

    await expect(
      m.prisma.creditTransaction.update({
        where: { id: entry.id },
        data: { amountMicro: 999_999n },
      }),
    ).rejects.toThrow(/append-only/);
  });
});
