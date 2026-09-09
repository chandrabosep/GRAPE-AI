import { prisma } from '@aam/db';
import {
  selectWinner,
  type AdRequestContext,
  type CandidateCampaign,
  type RankedCandidate,
} from '@aam/economics';
import {
  onchainCriteriaSchema,
  type AIIntent,
  type OnchainSignals,
  type Persona,
  type SponsoredAd,
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
    sessionId
      ? prisma.adImpression.count({
          where: { userId, createdAt: { gte: new Date(now - DAY_MS) } },
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
 * Coarse pre-filter in SQL, precise filtering in the ranking engine.
 *
 * Only conditions that are cheap and safe to express as indexed predicates go
 * here; everything nuanced stays in one place in @aam/economics so the rules
 * cannot drift between the database and the scorer.
 */
async function loadCandidates(now: Date): Promise<CandidateCampaign[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: 'active',
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    include: {
      targeting: true,
      advertiser: { select: { name: true } },
      creatives: { where: { status: 'active' }, take: 1, orderBy: { createdAt: 'asc' } },
    },
    take: 200,
  });

  const candidates: CandidateCampaign[] = [];

  for (const campaign of campaigns) {
    const creative = campaign.creatives[0];
    if (!creative || !campaign.targeting) continue;

    const remaining = campaign.budgetMicro - campaign.spentMicro;
    if (remaining < campaign.bidMicro) continue;

    const frequencyCap = campaign.frequencyCap as { perUserPerHour?: number; perUserPerDay?: number };

    candidates.push({
      campaignId: campaign.id,
      advertiserName: campaign.advertiser.name,
      bidMicro: campaign.bidMicro,
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
  intent: AIIntent;
  onchain: OnchainSignals | null;
  model: string;
  requestId: string;
  intentId: string | null;
  sessionId: string | null;
  adsEnabled: boolean;
}

export async function selectAd(input: SelectAdInput): Promise<SponsoredAd | null> {
  const config = economics();
  const now = new Date();

  if (!input.adsEnabled || input.user.profile?.adsOptOut) return null;

  const [candidates, frequency] = await Promise.all([
    loadCandidates(now),
    loadFrequency(input.user.id, input.sessionId),
  ]);

  if (candidates.length === 0) return null;

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

  const winner: RankedCandidate | null = selectWinner(
    candidates,
    ctx,
    config.weights,
    config.caps.maxAdsPerSession,
  );
  if (!winner) return null;

  const charged = await reserveBudget(winner.campaign.campaignId, winner.campaign.bidMicro);
  if (!charged) {
    // Budget went in the time between ranking and reserving. Show nothing rather
    // than serve an impression nobody is paying for.
    logger.debug({ campaignId: winner.campaign.campaignId }, 'lost budget race, skipping ad');
    return null;
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
      scoreTotal: winner.score.total,
      scoreBreakdown,
      signalsUsed: winner.reasons,
    },
    select: { id: true },
  });

  const rewardShare = BigInt(
    Math.floor(Number(winner.campaign.bidMicro) * config.allocation.reward),
  );

  return {
    impressionId: impression.id,
    headline: winner.campaign.creative.headline,
    body: winner.campaign.creative.body,
    ctaText: winner.campaign.creative.ctaText,
    ctaUrl: winner.campaign.creative.ctaUrl,
    imageUrl: winner.campaign.creative.imageUrl,
    advertiserName: winner.campaign.advertiserName,
    reasons: winner.reasons,
    estimatedRewardMicro: Number(rewardShare),
  };
}
