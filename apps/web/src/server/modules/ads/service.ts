import { prisma } from '@aam/db';
import {
  applyTier,
  explainNoWinner,
  selectRemnant,
  selectWinner,
  type AdRequestContext,
  type CandidateCampaign,
  type RankedCandidate,
} from '@aam/economics';
import {
  onchainCriteriaSchema,
  type AdSkippedReason,
  type AIIntent,
  type CreativeFormat,
  type OnchainSignals,
  type Persona,
  type SponsoredAd,
  type Tier,
} from '@aam/shared';
import { economics } from '../../config/index';
import { logger } from '../../lib/logger';
import type { UserWithProfile } from '../users/service';

/**
 * Ad selection.
 *
 * Loads the campaigns that could run, ranks them with the deterministic engine
 * in @aam/economics, and records the winner as an impression. The impression is
 * created unrewarded: attention has to be confirmed by the client before any
 * money moves.
 *
 * Returning null is a normal, intended outcome. If nothing clears the relevance
 * floor the user simply sees no sponsored card, because an irrelevant ad costs
 * more trust than the impression is worth.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface FrequencyCounts {
  lastHour: Record<string, number>;
  last24h: Record<string, number>;
  sessionCount: number;
}

async function loadFrequency(userId: string, sessionId: string | null): Promise<FrequencyCounts> {
  const now = Date.now();

  const [hourRows, dayRows, sessionCount] = await Promise.all([
    prisma.adImpression.groupBy({
      by: ['campaignId'],
      where: { userId, createdAt: { gte: new Date(now - HOUR_MS) } },
      _count: { _all: true },
    }),
    prisma.adImpression.groupBy({
      by: ['campaignId'],
      where: { userId, createdAt: { gte: new Date(now - DAY_MS) } },
      _count: { _all: true },
    }),
    // Scoped to the conversation, which is what `maxAdsPerSession` means.
    // This took `sessionId` and then counted every impression the user had in
    // 24 hours regardless of it, so a limit of 10 per conversation silently
    // behaved as 10 per day and ads stopped for the rest of the day.
    //
    // Still time-bounded, so a client that reuses one session id forever cannot
    // accumulate its way to a permanent block.
    sessionId
      ? prisma.adImpression.count({
          where: { userId, sessionId, createdAt: { gte: new Date(now - DAY_MS) } },
        })
      : Promise.resolve(0),
  ]);

  const toMap = (rows: { campaignId: string; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((r) => [r.campaignId, r._count._all]));

  return {
    lastHour: toMap(hourRows),
    last24h: toMap(dayRows),
    sessionCount,
  };
}

/**
 * What one impression of this format costs the advertiser.
 *
 * Rounded down, and floored at one micro-USD so a cheap bid on a discounted
 * slot can never become free — a charge of zero would serve an impression that
 * nobody paid for and that earns the developer nothing.
 */
function scaleBid(bidMicro: bigint, format: CreativeFormat): bigint {
  const multiplier = economics().formats[format].bidMultiplier;
  if (multiplier === 1) return bidMicro;
  const scaled = BigInt(Math.floor(Number(bidMicro) * multiplier));
  return scaled > 0n ? scaled : 1n;
}

/**
 * Coarse pre-filter in SQL, precise filtering in the ranking engine.
 *
 * Only conditions that are cheap and safe to express as indexed predicates go
 * here; everything nuanced stays in one place in @aam/economics so the rules
 * cannot drift between the database and the scorer.
 */
async function loadCandidates(now: Date, format: CreativeFormat): Promise<CandidateCampaign[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: 'active',
      startsAt: { lte: now },
      endsAt: { gte: now },
      // A campaign with no creative for this slot cannot fill it, so it is not
      // a candidate for it. This is what lets a campaign run inline-only or
      // banner-only without either slot silently falling back to the other.
      creatives: { some: { status: 'active', format } },
    },
    include: {
      targeting: true,
      advertiser: { select: { id: true, name: true } },
      creatives: { where: { status: 'active', format }, take: 1 },
    },
    take: 200,
  });

  const candidates: CandidateCampaign[] = [];

  for (const campaign of campaigns) {
    const creative = campaign.creatives[0];
    if (!creative || !campaign.targeting) continue;

    // The slot's price, not the campaign's headline bid. Scaling every
    // candidate by the same factor leaves their relative order untouched, so
    // the auction is unchanged — only what the winner pays moves.
    const bidMicro = scaleBid(campaign.bidMicro, format);
    const remaining = campaign.budgetMicro - campaign.spentMicro;
    if (remaining < bidMicro) continue;

    const frequencyCap = campaign.frequencyCap as { perUserPerHour?: number; perUserPerDay?: number };

    candidates.push({
      campaignId: campaign.id,
      advertiserId: campaign.advertiser.id,
      advertiserName: campaign.advertiser.name,
      bidMicro,
      budgetRemainingMicro: remaining,
      dailySpendRemainingMicro: campaign.dailySpendCapMicro,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      frequencyCap: {
        perUserPerHour: frequencyCap.perUserPerHour ?? 1,
        perUserPerDay: frequencyCap.perUserPerDay ?? 3,
      },
      targeting: {
        countries: campaign.targeting.countries,
        personas: campaign.targeting.personas,
        interests: campaign.targeting.interests,
        technologies: campaign.targeting.technologies,
        intentCategories: campaign.targeting.intentCategories,
        aiIntents: campaign.targeting.aiIntents,
        models: campaign.targeting.models,
        minCommercialIntent: campaign.targeting.minCommercialIntent as 'low' | 'medium' | 'high',
        onchainCriteria: onchainCriteriaSchema.parse(campaign.targeting.onchainCriteria ?? {}),
        onchainMode: campaign.targeting.onchainMode,
      },
      creative: {
        id: creative.id,
        format: creative.format,
        headline: creative.headline,
        body: creative.body,
        ctaText: creative.ctaText,
        ctaUrl: creative.ctaUrl,
        imageUrl: creative.imageUrl,
      },
    });
  }

  return candidates;
}

/**
 * Charges the campaign for the impression, atomically.
 *
 * The conditional update is what makes concurrent requests safe: two impressions
 * racing on the last of a budget cannot both succeed, because only one update
 * will match the remaining-budget predicate.
 */
async function reserveBudget(campaignId: string, bidMicro: bigint): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE campaigns
       SET spent_micro = spent_micro + ${bidMicro}
     WHERE id = ${campaignId}
       AND status = 'active'
       AND budget_micro - spent_micro >= ${bidMicro}
  `;
  return result === 1;
}

export interface SelectAdInput {
  user: UserWithProfile;
  /**
   * The developer's rung on the earning ladder.
   *
   * Passed in rather than read here because both slots of one answer belong to
   * the same person: resolving it per auction would count the same rewards
   * twice per turn to reach the same number. It only affects the reward
   * estimate shown on the card — the auction itself is blind to it, so what a
   * developer earns can never influence which ad they are shown.
   */
  tier: Tier;
  intent: AIIntent;
  onchain: OnchainSignals | null;
  model: string;
  requestId: string;
  intentId: string | null;
  sessionId: string | null;
  adsEnabled: boolean;
  /** Which slot is being filled. Each is its own auction and its own charge. */
  format: CreativeFormat;
  /**
   * Advertisers that already won another slot in this same turn.
   *
   * Excluded by advertiser rather than by campaign, because the advertiser is
   * what a developer actually reads: two campaigns from one company filling
   * both slots looks exactly like being shown the same ad twice, however
   * different the two creatives are.
   *
   * The frequency cap cannot do this job — it counts impressions, and neither
   * impression exists yet at the moment the other is ranked.
   */
  excludeAdvertiserIds?: string[];
  /**
   * May this slot fall back to an untargeted campaign when nothing clears the
   * relevance floor? Defaults to yes.
   *
   * Remnant inventory is scarce — an untargeted campaign is a rare thing to
   * have on the books — and the two slots do not pay the same for it, so which
   * of them is allowed to claim it is a pricing decision rather than a ranking
   * one. It is made by the caller filling both slots, not here.
   */
  allowRemnant?: boolean;
}

/**
 * The outcome of one auction.
 *
 * `null` with a reason rather than a bare `null`: an empty slot is a normal,
 * intended outcome, and the client has to be able to say which of the several
 * very different normal outcomes it was.
 */
export interface AdSelection {
  ad: SponsoredAd | null;
  reason: AdSkippedReason | null;
  /**
   * Who won, for callers filling a second slot in the same turn. Kept off `ad`
   * because it is internal bookkeeping rather than something the client needs.
   */
  advertiserId: string | null;
}

const SKIPPED = (reason: AdSkippedReason): AdSelection => ({
  ad: null,
  reason,
  advertiserId: null,
});

export async function selectAd(input: SelectAdInput): Promise<AdSelection> {
  const config = economics();
  const now = new Date();

  if (!input.adsEnabled || input.user.profile?.adsOptOut) return SKIPPED('ads_disabled');

  const [loaded, frequency] = await Promise.all([
    loadCandidates(now, input.format),
    loadFrequency(input.user.id, input.sessionId),
  ]);

  const excluded = new Set(input.excludeAdvertiserIds ?? []);
  const candidates =
    excluded.size === 0 ? loaded : loaded.filter((c) => !excluded.has(c.advertiserId));

  if (candidates.length === 0) return SKIPPED('no_campaigns');

  const ctx: AdRequestContext = {
    intent: input.intent,
    user: {
      persona: (input.user.profile?.persona as Persona | null) ?? null,
      interests: input.user.profile?.interests ?? [],
      technologies: input.user.profile?.technologies ?? [],
      countryCode: input.user.countryCode,
      fraudScore: Number(input.user.fraudScore),
    },
    onchain: input.onchain,
    model: input.model,
    adsEnabled: input.adsEnabled,
    adsOptOut: input.user.profile?.adsOptOut ?? false,
    sessionAdCount: frequency.sessionCount,
    impressionsLastHour: frequency.lastHour,
    impressionsLast24h: frequency.last24h,
    now,
  };

  let winner: RankedCandidate | null = selectWinner(
    candidates,
    ctx,
    config.weights,
    config.caps.maxAdsPerSession,
  );

  // Nothing was relevant enough. The slot is unsold, so it goes to a campaign
  // that bid for any developer rather than for this one — never to a targeted
  // campaign that simply scored badly, and only if this slot is the one the
  // caller wants remnant inventory spent on.
  let remnant = false;
  if (!winner && config.remnant.enabled && input.allowRemnant !== false) {
    winner = selectRemnant(candidates, ctx, config.caps.maxAdsPerSession);
    remnant = winner !== null;
  }

  if (!winner) {
    return SKIPPED(
      explainNoWinner(candidates, ctx, config.weights, config.caps.maxAdsPerSession),
    );
  }

  const charged = await reserveBudget(winner.campaign.campaignId, winner.campaign.bidMicro);
  if (!charged) {
    // Budget went in the time between ranking and reserving. Show nothing rather
    // than serve an impression nobody is paying for.
    logger.debug({ campaignId: winner.campaign.campaignId }, 'lost budget race, skipping ad');
    return SKIPPED('budget_exhausted');
  }

  // Prisma's Json input needs an index signature; the breakdown is all numbers.
  const scoreBreakdown: Record<string, number> = { ...winner.score };

  const impression = await prisma.adImpression.create({
    data: {
      userId: input.user.id,
      campaignId: winner.campaign.campaignId,
      creativeId: winner.campaign.creative.id,
      requestId: input.requestId,
      intentId: input.intentId,
      sessionId: input.sessionId,
      format: input.format,
      // What was actually reserved, recorded now. Reading the charge back off
      // today's config would misreport a campaign that ran under an older one.
      chargedMicro: winner.campaign.bidMicro,
      scoreTotal: winner.score.total,
      scoreBreakdown,
      signalsUsed: remnant ? [config.remnant.label, ...winner.reasons] : winner.reasons,
    },
    select: { id: true },
  });

  // Quoted at this developer's tier, so the card promises what the ack will
  // actually pay. It is still an estimate: the daily ceiling and the abuse
  // gates are only evaluated once the impression is confirmed.
  const allocation = applyTier(config.allocation, input.tier);
  const rewardShare = BigInt(Math.floor(Number(winner.campaign.bidMicro) * allocation.reward));

  const ad: SponsoredAd = {
    impressionId: impression.id,
    format: input.format,
    headline: winner.campaign.creative.headline,
    body: winner.campaign.creative.body,
    ctaText: winner.campaign.creative.ctaText,
    ctaUrl: winner.campaign.creative.ctaUrl,
    imageUrl: winner.campaign.creative.imageUrl,
    advertiserName: winner.campaign.advertiserName,
    reasons: winner.reasons,
    estimatedRewardMicro: Number(rewardShare),
  };

  return { ad, reason: null, advertiserId: winner.campaign.advertiserId };
}
