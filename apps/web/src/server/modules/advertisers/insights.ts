import { prisma } from '@aam/db';
import type { CreativeFormat } from '@aam/shared';

/**
 * Campaign performance, for the advertiser dashboard.
 *
 * Everything here is an aggregate over the advertiser's own campaigns, computed
 * from the impression and engagement tables rather than a rollup, so a number
 * on the dashboard is never stale relative to what just happened in a chat. The
 * same privacy rule as the rest of the advertiser surface applies: there is no
 * query in this module that can return a row about one person, and every series
 * is grouped by day or by format, never by user.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day of a campaign's life, as the charts consume it. */
export interface InsightPoint {
  /** ISO date, yyyy-mm-dd. */
  day: string;
  impressions: number;
  qualified: number;
  clicks: number;
  spendMicro: string;
  rewardMicro: string;
  /** Clicks over qualified impressions, 0..1. Zero when nothing qualified. */
  clickThroughRate: number;
}

export interface FormatBreakdown {
  format: CreativeFormat;
  impressions: number;
  qualified: number;
  clicks: number;
  spendMicro: string;
  clickThroughRate: number;
}

export interface InsightTotals {
  impressions: number;
  qualified: number;
  clicks: number;
  spendMicro: string;
  rewardMicro: string;
  /** Qualified over selected: how often a served ad was actually looked at. */
  viewRate: number;
  /** Clicks over qualified: the conversion number advertisers optimise. */
  clickThroughRate: number;
  /** Spend per click, micro-USD. Null when there are no clicks to divide by. */
  costPerClickMicro: string | null;
  /** Spend per thousand qualified impressions, micro-USD. */
  costPerMilleMicro: string | null;
  averageRelevance: number;
}

export interface CampaignInsights {
  totals: InsightTotals;
  /** One point per day in the window, including days with no activity. */
  series: InsightPoint[];
  byFormat: FormatBreakdown[];
  /** Which derived intents actually produced impressions, most first. */
  topIntents: { intent: string; impressions: number }[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * What an impression charged the campaign.
 *
 * The same rule the reward path uses, and deliberately so: a zero here means
 * the row predates the column rather than that the impression was free, and
 * reporting it as free would make historical spend disagree with the ledger
 * that actually paid out against it.
 */
function chargeOf(impression: {
  chargedMicro: bigint;
  campaign: { bidMicro: bigint };
}): bigint {
  return impression.chargedMicro > 0n ? impression.chargedMicro : impression.campaign.bidMicro;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The days the chart should show, whether or not anything happened on them.
 *
 * A series that silently omits quiet days draws a line that slopes between
 * whatever two days had traffic, which reads as steady delivery when it was
 * actually a gap.
 */
function emptySeries(since: Date, until: Date): Map<string, InsightPoint> {
  const points = new Map<string, InsightPoint>();
  for (let t = since.getTime(); t <= until.getTime(); t += DAY_MS) {
    const day = dayKey(new Date(t));
    points.set(day, {
      day,
      impressions: 0,
      qualified: 0,
      clicks: 0,
      spendMicro: '0',
      rewardMicro: '0',
      clickThroughRate: 0,
    });
  }
  return points;
}

export interface InsightsQuery {
  /** Restrict to one campaign. Omitted, it covers every campaign the advertiser owns. */
  campaignId?: string | undefined;
  days: number;
}

/**
 * Resolves which campaigns the aggregate covers.
 *
 * Ownership is resolved here, once, and every subsequent query is scoped to the
 * resulting ids — so a campaign id belonging to someone else returns an empty
 * result rather than their numbers.
 */
async function scopedCampaignIds(
  advertiserId: string,
  campaignId: string | undefined,
): Promise<string[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId, ...(campaignId ? { id: campaignId } : {}) },
    select: { id: true },
  });
  return campaigns.map((c) => c.id);
}

const EMPTY_TOTALS: InsightTotals = {
  impressions: 0,
  qualified: 0,
  clicks: 0,
  spendMicro: '0',
  rewardMicro: '0',
  viewRate: 0,
  clickThroughRate: 0,
  costPerClickMicro: null,
  costPerMilleMicro: null,
  averageRelevance: 0,
};

export async function campaignInsights(
  advertiserId: string,
  query: InsightsQuery,
): Promise<CampaignInsights> {
  const campaignIds = await scopedCampaignIds(advertiserId, query.campaignId);

  const until = new Date();
  const since = new Date(until.getTime() - (query.days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);

  if (campaignIds.length === 0) {
    return {
      totals: EMPTY_TOTALS,
      series: [...emptySeries(since, until).values()],
      byFormat: [],
      topIntents: [],
    };
  }

  const where = { campaignId: { in: campaignIds }, createdAt: { gte: since } };

  const [impressions, clicks, rewards] = await Promise.all([
    prisma.adImpression.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        format: true,
        qualified: true,
        chargedMicro: true,
        scoreTotal: true,
        intentId: true,
        // Only needed for impressions written before charged_micro existed.
        campaign: { select: { bidMicro: true } },
      },
    }),
    prisma.adEngagement.findMany({
      where: { type: 'click', impression: where },
      select: { createdAt: true, impression: { select: { format: true } } },
    }),
    prisma.reward.findMany({
      where: { campaignId: { in: campaignIds }, status: 'granted', createdAt: { gte: since } },
      select: { createdAt: true, amountMicro: true },
    }),
  ]);

  const series = emptySeries(since, until);
  const formats = new Map<CreativeFormat, FormatBreakdown>();

  let totalSpend = 0n;
  let totalReward = 0n;
  let qualifiedCount = 0;
  let scoreSum = 0;

  for (const impression of impressions) {
    const charged = chargeOf(impression);

    const point = series.get(dayKey(impression.createdAt));
    if (point) {
      point.impressions += 1;
      if (impression.qualified) point.qualified += 1;
      point.spendMicro = (BigInt(point.spendMicro) + charged).toString();
    }

    const format = impression.format as CreativeFormat;
    const bucket =
      formats.get(format) ??
      ({
        format,
        impressions: 0,
        qualified: 0,
        clicks: 0,
        spendMicro: '0',
        clickThroughRate: 0,
      } satisfies FormatBreakdown);
    bucket.impressions += 1;
    if (impression.qualified) bucket.qualified += 1;
    bucket.spendMicro = (BigInt(bucket.spendMicro) + charged).toString();
    formats.set(format, bucket);

    totalSpend += charged;
    if (impression.qualified) qualifiedCount += 1;
    scoreSum += Number(impression.scoreTotal);
  }

  for (const click of clicks) {
    const point = series.get(dayKey(click.createdAt));
    if (point) point.clicks += 1;

    const format = click.impression.format as CreativeFormat;
    const bucket = formats.get(format);
    if (bucket) bucket.clicks += 1;
  }

  for (const reward of rewards) {
    const point = series.get(dayKey(reward.createdAt));
    if (point) {
      point.rewardMicro = (BigInt(point.rewardMicro) + reward.amountMicro).toString();
    }
    totalReward += reward.amountMicro;
  }

  for (const point of series.values()) {
    point.clickThroughRate = ratio(point.clicks, point.qualified);
  }
  for (const bucket of formats.values()) {
    bucket.clickThroughRate = ratio(bucket.clicks, bucket.qualified);
  }

  return {
    totals: {
      impressions: impressions.length,
      qualified: qualifiedCount,
      clicks: clicks.length,
      spendMicro: totalSpend.toString(),
      rewardMicro: totalReward.toString(),
      viewRate: ratio(qualifiedCount, impressions.length),
      clickThroughRate: ratio(clicks.length, qualifiedCount),
      costPerClickMicro:
        clicks.length > 0 ? (totalSpend / BigInt(clicks.length)).toString() : null,
      costPerMilleMicro:
        qualifiedCount > 0 ? ((totalSpend * 1000n) / BigInt(qualifiedCount)).toString() : null,
      averageRelevance: ratio(scoreSum, impressions.length),
    },
    series: [...series.values()],
    byFormat: [...formats.values()],
    topIntents: await topIntents(impressions),
  };
}

/**
 * The derived intents that actually won impressions.
 *
 * Taxonomy values only — the intent record holds no prompt text by design, so
 * this cannot leak what anyone typed even in aggregate.
 */
async function topIntents(
  impressions: { intentId: string | null }[],
): Promise<{ intent: string; impressions: number }[]> {
  const intentIds = impressions
    .map((i) => i.intentId)
    .filter((id): id is string => id !== null);

  if (intentIds.length === 0) return [];

  const grouped = await prisma.aiIntentRecord.groupBy({
    by: ['intent'],
    where: { id: { in: intentIds } },
    _count: { _all: true },
    orderBy: { _count: { intent: 'desc' } },
    take: 8,
  });

  return grouped.map((row) => ({ intent: row.intent, impressions: row._count._all }));
}
