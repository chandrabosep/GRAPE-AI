import { DEFAULT_ECONOMICS, EMPTY_ONCHAIN_CRITERIA, type OnchainSignals } from '@aam/shared';
import { describe, expect, it } from 'vitest';
import { checkEligibility, evaluateOnchainCriteria, rankCandidates, selectWinner } from './scoring';
import type { AdRequestContext, CandidateCampaign } from './types';

const WEIGHTS = DEFAULT_ECONOMICS.weights;
const MAX_ADS = DEFAULT_ECONOMICS.caps.maxAdsPerSession;
const NOW = new Date('2026-09-10T12:00:00Z');

function campaign(overrides: Partial<CandidateCampaign> = {}): CandidateCampaign {
  return {
    campaignId: 'c1',
    advertiserId: 'a1',
    advertiserName: 'Acme RPC',
    bidMicro: 10_000n,
    budgetRemainingMicro: 1_000_000n,
    dailySpendRemainingMicro: null,
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2026-12-01T00:00:00Z'),
    frequencyCap: { perUserPerHour: 1, perUserPerDay: 3 },
    creative: {
      id: 'cr1',
      format: 'banner',
      headline: 'Deploy faster',
      body: 'Managed Ethereum RPC',
      ctaText: 'Learn more',
      ctaUrl: 'https://example.com',
      imageUrl: null,
    },
    ...overrides,
    targeting: {
      countries: [],
      personas: [],
      interests: [],
      technologies: [],
      intentCategories: [],
      aiIntents: [],
      models: [],
      minCommercialIntent: 'low',
      onchainCriteria: EMPTY_ONCHAIN_CRITERIA,
      onchainMode: 'off',
      ...overrides.targeting,
    },
  };
}

function context(overrides: Partial<AdRequestContext> = {}): AdRequestContext {
  return {
    intent: {
      category: 'infrastructure',
      intent: 'smart_contract_deployment',
      technologies: ['solidity', 'ethereum', 'foundry'],
      persona: 'web3_developer',
      commercialIntent: 'high',
      confidence: 0.9,
    },
    user: {
      persona: 'web3_developer',
      interests: ['web3', 'devtools'],
      technologies: ['solidity'],
      countryCode: 'IN',
      fraudScore: 0,
    },
    onchain: null,
    model: 'us.anthropic.claude-sonnet-5',
    adsEnabled: true,
    adsOptOut: false,
    sessionAdCount: 0,
    impressionsLastHour: {},
    impressionsLast24h: {},
    now: NOW,
    ...overrides,
  };
}

const defiSignals: OnchainSignals = {
  walletActivity: true,
  ethereumActivity: true,
  lendingActivity: true,
  dexActivity: true,
  defiActivity: true,
  nftHolder: false,
  ensHolder: true,
  stablecoinHolder: true,
  protocols: ['aave-v3', 'uniswap-v3'],
  protocolTypes: ['lending', 'dex'],
  chains: ['mainnet'],
  lastActivityDaysAgo: 4,
  activityScore: 0.82,
  windowDays: 30,
};

describe('eligibility', () => {
  it('rejects every campaign when the plan disables ads', () => {
    const result = checkEligibility(campaign(), context({ adsEnabled: false }), MAX_ADS);
    expect(result).toEqual({ eligible: false, reason: 'ads_disabled_for_plan' });
  });

  it('respects an explicit user opt-out', () => {
    const result = checkEligibility(campaign(), context({ adsOptOut: true }), MAX_ADS);
    expect(result.reason).toBe('user_opted_out');
  });

  it('refuses a campaign that cannot afford its own bid', () => {
    const c = campaign({ bidMicro: 10_000n, budgetRemainingMicro: 9_999n });
    expect(checkEligibility(c, context(), MAX_ADS).reason).toBe('budget_exhausted');
  });

  it('enforces the hourly frequency cap per campaign', () => {
    const ctx = context({ impressionsLastHour: { c1: 1 } });
    expect(checkEligibility(campaign(), ctx, MAX_ADS).reason).toBe('frequency_cap_hour');
  });

  it('excludes users below the campaign minimum commercial intent', () => {
    const c = campaign({ targeting: { minCommercialIntent: 'high' } as never });
    const ctx = context({ intent: { ...context().intent, commercialIntent: 'low' } });
    expect(checkEligibility(c, ctx, MAX_ADS).reason).toBe('commercial_intent_too_low');
  });

  it('treats missing signals as ineligible when onchain targeting is required', () => {
    const c = campaign({
      targeting: {
        onchainMode: 'require',
        onchainCriteria: { ...EMPTY_ONCHAIN_CRITERIA, protocolTypes: ['lending'] },
      } as never,
    });
    expect(checkEligibility(c, context({ onchain: null }), MAX_ADS).reason).toBe(
      'onchain_signals_missing',
    );
  });

  it('admits a wallet that satisfies every required criterion', () => {
    const c = campaign({
      targeting: {
        onchainMode: 'require',
        onchainCriteria: {
          ...EMPTY_ONCHAIN_CRITERIA,
          requireWalletActivity: true,
          protocolTypes: ['lending', 'dex'],
        },
      } as never,
    });
    expect(checkEligibility(c, context({ onchain: defiSignals }), MAX_ADS).eligible).toBe(true);
  });
});

describe('onchain criteria evaluation', () => {
  it('counts named protocols as a single OR condition', () => {
    const result = evaluateOnchainCriteria(
      { ...EMPTY_ONCHAIN_CRITERIA, protocols: ['aave-v3', 'compound-v3'] },
      defiSignals,
    );
    expect(result).toMatchObject({ satisfied: 1, total: 1 });
    expect(result.matched).toContain('protocol_aave-v3');
  });

  it('reports zero criteria when nothing is configured', () => {
    expect(evaluateOnchainCriteria(EMPTY_ONCHAIN_CRITERIA, defiSignals).total).toBe(0);
  });
});

describe('ranking', () => {
  it('prefers an exact intent match over a bigger bid', () => {
    const precise = campaign({
      campaignId: 'precise',
      bidMicro: 5_000n,
      targeting: {
        aiIntents: ['smart_contract_deployment'],
        technologies: ['solidity', 'foundry'],
      } as never,
    });
    const generic = campaign({ campaignId: 'generic', bidMicro: 50_000n });

    const winner = selectWinner([generic, precise], context(), WEIGHTS, MAX_ADS);
    expect(winner?.campaign.campaignId).toBe('precise');
  });

  it('lets onchain signals decide between otherwise identical campaigns', () => {
    const base = {
      bidMicro: 10_000n,
      targeting: { aiIntents: ['smart_contract_deployment'] },
    };
    const plain = campaign({ campaignId: 'plain', ...base } as never);
    const defiTargeted = campaign({
      campaignId: 'defi',
      ...base,
      targeting: {
        aiIntents: ['smart_contract_deployment'],
        onchainMode: 'boost',
        onchainCriteria: { ...EMPTY_ONCHAIN_CRITERIA, protocolTypes: ['lending'] },
      },
    } as never);

    const withWallet = selectWinner(
      [plain, defiTargeted],
      context({ onchain: defiSignals }),
      WEIGHTS,
      MAX_ADS,
    );
    expect(withWallet?.campaign.campaignId).toBe('defi');

    // Same auction, same campaigns, no linked wallet: the boost disappears and
    // the tie-break falls back to campaign id order.
    const withoutWallet = selectWinner(
      [plain, defiTargeted],
      context({ onchain: null }),
      WEIGHTS,
      MAX_ADS,
    );
    expect(withoutWallet?.campaign.campaignId).toBe('defi');
    expect(withoutWallet?.score.onchainMatch).toBe(0);
  });

  it('shows nothing rather than something irrelevant', () => {
    const unrelated = campaign({
      campaignId: 'unrelated',
      bidMicro: 1n,
      targeting: { aiIntents: ['nft_development'], technologies: ['solana'] } as never,
    });
    const ranked = rankCandidates([unrelated], context(), WEIGHTS, MAX_ADS);
    expect(ranked).toHaveLength(0);
  });

  it('discounts a low-confidence classification', () => {
    const c = campaign({
      targeting: { aiIntents: ['smart_contract_deployment'], technologies: ['solidity'] } as never,
    });
    const confident = selectWinner([c], context(), WEIGHTS, MAX_ADS);
    const unsure = selectWinner(
      [c],
      context({ intent: { ...context().intent, confidence: 0.1 } }),
      WEIGHTS,
      MAX_ADS,
    );
    expect(confident!.score.intentMatch).toBeGreaterThan(unsure!.score.intentMatch);
  });

  it('penalises a campaign the user has already seen today', () => {
    const c = campaign({
      targeting: { aiIntents: ['smart_contract_deployment'] } as never,
    });
    const fresh = selectWinner([c], context(), WEIGHTS, MAX_ADS);
    const repeated = selectWinner(
      [c],
      context({ impressionsLast24h: { c1: 2 } }),
      WEIGHTS,
      MAX_ADS,
    );
    expect(repeated!.score.total).toBeLessThan(fresh!.score.total);
  });

  it('surfaces only categorical reasons, never free text', () => {
    const c = campaign({
      targeting: {
        aiIntents: ['smart_contract_deployment'],
        technologies: ['solidity'],
        personas: ['web3_developer'],
        onchainMode: 'boost',
        onchainCriteria: { ...EMPTY_ONCHAIN_CRITERIA, protocolTypes: ['lending'] },
      } as never,
    });
    const winner = selectWinner([c], context({ onchain: defiSignals }), WEIGHTS, MAX_ADS);
    expect(winner?.reasons).toEqual(
      expect.arrayContaining(['smart_contract_deployment', 'solidity', 'lending_activity_30d']),
    );
    for (const reason of winner!.reasons) {
      expect(reason).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('does not punish a campaign for leaving a targeting dimension blank', () => {
    // "no persona specified" means anyone, not nobody. A broad campaign should
    // land on the neutral baseline rather than score zero on audience.
    const broad = campaign({
      campaignId: 'broad',
      targeting: { aiIntents: ['smart_contract_deployment'] } as never,
    });
    const narrowMiss = campaign({
      campaignId: 'narrow',
      targeting: {
        aiIntents: ['smart_contract_deployment'],
        personas: ['data_engineer'],
        interests: ['gaming'],
      } as never,
    });

    const ranked = rankCandidates([narrowMiss, broad], context(), WEIGHTS, MAX_ADS);
    expect(ranked[0]?.campaign.campaignId).toBe('broad');
  });

  it('rejects a campaign that bids high but targets nothing relevant', () => {
    const bidOnly = campaign({ campaignId: 'bid-only', bidMicro: 1_000_000n });
    expect(rankCandidates([bidOnly], context(), WEIGHTS, MAX_ADS)).toHaveLength(0);
  });

  /**
   * The inline slot runs at a lower floor than the banner, and this is the
   * bound on how low it may go.
   *
   * An untargeted campaign asked for nobody, so the only way it may ever fill a
   * slot is `selectRemnant` — which labels the impression `unsold_slot` and
   * records a zero score. If a format's floor drops to or below what such a
   * campaign scores unopposed, it starts winning ordinary auctions instead:
   * labelled as relevant, scored as relevant, and taking the slot from the
   * remnant path that exists to handle exactly this case.
   */
  it('keeps an untargeted campaign below every per-format floor', () => {
    const brand = campaign({ campaignId: 'brand', bidMicro: 1_000_000n });

    // Unopposed, so `bidWeight` is 1 and this is the highest it can ever score.
    const [ranked] = rankCandidates([brand], context(), { ...WEIGHTS, minScore: 0 }, MAX_ADS);
    const ceiling = ranked!.score.total;

    expect(ceiling).toBeCloseTo(WEIGHTS.audience * 0.5 + WEIGHTS.bid * 1, 10);

    for (const [format, economics] of Object.entries(DEFAULT_ECONOMICS.formats)) {
      expect(
        economics.minScore,
        `the ${format} floor must stay above the untargeted ceiling of ${ceiling}`,
      ).toBeGreaterThan(ceiling);
    }
  });

  it('is deterministic for identical input', () => {
    const pool = [
      campaign({
        campaignId: 'a',
        targeting: { aiIntents: ['smart_contract_deployment'] } as never,
      }),
      campaign({
        campaignId: 'b',
        targeting: { aiIntents: ['smart_contract_deployment'] } as never,
      }),
    ];
    const first = rankCandidates(pool, context(), WEIGHTS, MAX_ADS).map(
      (r) => r.campaign.campaignId,
    );
    const second = rankCandidates(pool, context(), WEIGHTS, MAX_ADS).map(
      (r) => r.campaign.campaignId,
    );
    expect(first).toEqual(second);
  });
});
