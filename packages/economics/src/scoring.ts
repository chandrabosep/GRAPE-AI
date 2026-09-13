import {
  COMMERCIAL_INTENT_RANK,
  INTENT_TO_CATEGORY,
  type OnchainCriteria,
  type OnchainSignals,
  type ScoringWeights,
} from '@aam/shared';
import type {
  AdRequestContext,
  CandidateCampaign,
  EligibilityResult,
  RankedCandidate,
  ScoreBreakdown,
} from './types';

/**
 * Deterministic ad ranking.
 *
 * Every input is a number we can point at in a demo and every output is
 * explainable, which matters more here than accuracy: an advertiser has to be
 * able to see why they won or lost an auction, and a user has to be able to see
 * why they were shown something. The signature is the seam where an ML ranker
 * would drop in later.
 */

function intersection(a: readonly string[], b: readonly string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

/**
 * Overlap as a fraction of the campaign's requirement, not of the user's breadth.
 * Returns null when the campaign asked for nothing, so the caller can treat that
 * dimension as neutral instead of as a failed match.
 */
function overlapRatio(
  userValues: readonly string[],
  campaignValues: readonly string[],
): number | null {
  if (campaignValues.length === 0) return null;
  return intersection(campaignValues, userValues).length / campaignValues.length;
}

/**
 * Averages only the dimensions a campaign actually specified.
 *
 * A campaign that leaves audience targeting blank is saying "anyone", not
 * "nobody". Scoring the blank dimensions as zero would punish broad campaigns
 * for being broad and let a narrowly-targeted campaign win on the arithmetic
 * alone, so unspecified dimensions drop out and a fully-unspecified audience
 * lands on a neutral baseline.
 */
const NEUTRAL_AUDIENCE = 0.5;

function averageSpecified(values: (number | null)[]): number {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return NEUTRAL_AUDIENCE;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection(a, b).length / union.size;
}

/** Counts satisfied criteria and how many were asked for. */
export function evaluateOnchainCriteria(
  criteria: OnchainCriteria,
  signals: OnchainSignals | null,
): { satisfied: number; total: number; matched: string[] } {
  const checks: { required: boolean; ok: boolean; label: string }[] = [
    {
      required: criteria.requireWalletActivity,
      ok: signals?.walletActivity === true,
      label: 'wallet_activity',
    },
    {
      required: criteria.requireEnsHolder,
      ok: signals?.ensHolder === true,
      label: 'ens_holder',
    },
    {
      required: criteria.requireStablecoinHolder,
      ok: signals?.stablecoinHolder === true,
      label: 'stablecoin_holder',
    },
    {
      required: criteria.requireNftHolder,
      ok: signals?.nftHolder === true,
      label: 'nft_holder',
    },
  ];

  for (const type of criteria.protocolTypes) {
    checks.push({
      required: true,
      ok: signals?.protocolTypes.includes(type) === true,
      label: `${type}_activity_${criteria.activityWindowDays}d`,
    });
  }

  // Named protocols are an OR: interacting with any one of them satisfies the ask.
  if (criteria.protocols.length > 0) {
    const hit = intersection(criteria.protocols, signals?.protocols ?? []);
    checks.push({
      required: true,
      ok: hit.length > 0,
      label: hit.length > 0 ? `protocol_${hit[0]}` : 'protocol_match',
    });
  }

  const active = checks.filter((c) => c.required);
  return {
    satisfied: active.filter((c) => c.ok).length,
    total: active.length,
    matched: active.filter((c) => c.ok).map((c) => c.label),
  };
}

/** Hard filters. Anything that fails here never enters the auction. */
export function checkEligibility(
  campaign: CandidateCampaign,
  ctx: AdRequestContext,
  maxAdsPerSession: number,
): EligibilityResult {
  if (!ctx.adsEnabled) return { eligible: false, reason: 'ads_disabled_for_plan' };
  if (ctx.adsOptOut) return { eligible: false, reason: 'user_opted_out' };
  if (ctx.sessionAdCount >= maxAdsPerSession) {
    return { eligible: false, reason: 'session_ad_limit' };
  }

  if (ctx.now < campaign.startsAt) return { eligible: false, reason: 'not_started' };
  if (ctx.now > campaign.endsAt) return { eligible: false, reason: 'ended' };

  if (campaign.budgetRemainingMicro < campaign.bidMicro) {
    return { eligible: false, reason: 'budget_exhausted' };
  }
  if (
    campaign.dailySpendRemainingMicro !== null &&
    campaign.dailySpendRemainingMicro < campaign.bidMicro
  ) {
    return { eligible: false, reason: 'daily_cap_reached' };
  }

  const t = campaign.targeting;

  if (t.countries.length > 0) {
    if (!ctx.user.countryCode || !t.countries.includes(ctx.user.countryCode)) {
      return { eligible: false, reason: 'country_excluded' };
    }
  }
  if (t.personas.length > 0) {
    const persona = ctx.intent.persona ?? ctx.user.persona;
    if (!persona || !t.personas.includes(persona)) {
      return { eligible: false, reason: 'persona_excluded' };
    }
  }
  if (t.models.length > 0 && !t.models.includes(ctx.model)) {
    return { eligible: false, reason: 'model_excluded' };
  }
  if (
    COMMERCIAL_INTENT_RANK[ctx.intent.commercialIntent] <
    COMMERCIAL_INTENT_RANK[t.minCommercialIntent]
  ) {
    return { eligible: false, reason: 'commercial_intent_too_low' };
  }

  const hourCount = ctx.impressionsLastHour[campaign.campaignId] ?? 0;
  if (hourCount >= campaign.frequencyCap.perUserPerHour) {
    return { eligible: false, reason: 'frequency_cap_hour' };
  }
  const dayCount = ctx.impressionsLast24h[campaign.campaignId] ?? 0;
  if (dayCount >= campaign.frequencyCap.perUserPerDay) {
    return { eligible: false, reason: 'frequency_cap_day' };
  }

  if (t.onchainMode === 'require') {
    const { satisfied, total } = evaluateOnchainCriteria(t.onchainCriteria, ctx.onchain);
    if (total > 0 && ctx.onchain === null) {
      return { eligible: false, reason: 'onchain_signals_missing' };
    }
    if (satisfied < total) {
      return { eligible: false, reason: 'onchain_criteria_unmet' };
    }
  }

  return { eligible: true };
}

/** Scores one eligible campaign. `maxBidMicro` normalises the bid term across the auction. */
export function scoreCandidate(
  campaign: CandidateCampaign,
  ctx: AdRequestContext,
  weights: ScoringWeights,
  maxBidMicro: bigint,
): { score: ScoreBreakdown; reasons: string[] } {
  const t = campaign.targeting;
  const reasons: string[] = [];

  // Intent: an exact task match dominates, a category match is worth half,
  // and shared technologies fill in the rest.
  let intentBase = 0;
  if (t.aiIntents.includes(ctx.intent.intent)) {
    intentBase = 1;
    reasons.push(ctx.intent.intent);
  } else if (
    t.intentCategories.includes(ctx.intent.category) ||
    t.intentCategories.includes(INTENT_TO_CATEGORY[ctx.intent.intent])
  ) {
    intentBase = 0.5;
    reasons.push(ctx.intent.category);
  }

  // The live request and the stated profile both count as evidence of what the
  // developer works with.
  const userTech = [...new Set([...ctx.intent.technologies, ...ctx.user.technologies])];
  const techMatch = jaccard(userTech, t.technologies);
  for (const tech of intersection(t.technologies, userTech)) reasons.push(tech);

  // Weight the whole intent term by classifier confidence: a guess should not
  // win an auction as convincingly as a confident classification.
  const intentMatch = (intentBase * 0.6 + techMatch * 0.4) * (0.5 + 0.5 * ctx.intent.confidence);

  const personaValue = ctx.intent.persona ?? ctx.user.persona;
  const personaMatch =
    t.personas.length === 0 ? null : personaValue && t.personas.includes(personaValue) ? 1 : 0;
  const countryMatch =
    t.countries.length === 0
      ? null
      : ctx.user.countryCode && t.countries.includes(ctx.user.countryCode)
        ? 1
        : 0;
  const audienceMatch = averageSpecified([
    overlapRatio(ctx.user.interests, t.interests),
    personaMatch,
    countryMatch,
  ]);
  if (personaMatch === 1 && personaValue) reasons.push(personaValue);

  let onchainMatch = 0;
  if (t.onchainMode !== 'off') {
    const { satisfied, total, matched } = evaluateOnchainCriteria(t.onchainCriteria, ctx.onchain);
    onchainMatch = total === 0 ? 0 : satisfied / total;
    reasons.push(...matched);
  }

  const bidWeight = maxBidMicro === 0n ? 0 : Number(campaign.bidMicro) / Number(maxBidMicro);

  const dayCount = ctx.impressionsLast24h[campaign.campaignId] ?? 0;
  const frequencyPenalty =
    campaign.frequencyCap.perUserPerDay === 0
      ? 0
      : Math.min(1, dayCount / campaign.frequencyCap.perUserPerDay);

  const fraudPenalty = Math.min(1, Math.max(0, ctx.user.fraudScore));

  const total =
    weights.intent * intentMatch +
    weights.audience * audienceMatch +
    weights.onchain * onchainMatch +
    weights.bid * bidWeight -
    weights.frequency * frequencyPenalty -
    weights.fraud * fraudPenalty;

  return {
    score: {
      intentMatch,
      audienceMatch,
      onchainMatch,
      bidWeight,
      frequencyPenalty,
      fraudPenalty,
      total: Math.max(0, total),
    },
    reasons: [...new Set(reasons)].slice(0, 8),
  };
}

/**
 * Full auction: filter, score, order.
 *
 * Returns an empty list when nothing clears `minScore`. Showing no ad is a
 * valid, intended outcome — an irrelevant ad costs more trust than it earns.
 */
export function rankCandidates(
  candidates: CandidateCampaign[],
  ctx: AdRequestContext,
  weights: ScoringWeights,
  maxAdsPerSession: number,
): RankedCandidate[] {
  const eligible = candidates.filter((c) => checkEligibility(c, ctx, maxAdsPerSession).eligible);
  if (eligible.length === 0) return [];

  const maxBid = eligible.reduce((m, c) => (c.bidMicro > m ? c.bidMicro : m), 0n);

  return eligible
    .map((campaign) => {
      const { score, reasons } = scoreCandidate(campaign, ctx, weights, maxBid);
      return { campaign, score, reasons };
    })
    .filter((r) => r.score.total >= weights.minScore)
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      // Ties go to the higher bid, then to a stable id order so the same request
      // always produces the same winner.
      if (b.campaign.bidMicro !== a.campaign.bidMicro) {
        return b.campaign.bidMicro > a.campaign.bidMicro ? 1 : -1;
      }
      return a.campaign.campaignId.localeCompare(b.campaign.campaignId);
    });
}

/**
 * Why the auction produced nothing.
 *
 * A silent empty slot is indistinguishable from a broken pipeline, which costs
 * far more debugging time than the reason costs to compute. These are coarse on
 * purpose: they describe the auction, never the user.
 */
export type NoWinnerReason =
  | 'ads_disabled'
  | 'no_campaigns'
  | 'below_relevance_floor'
  | 'frequency_capped'
  | 'audience_excluded'
  | 'onchain_required'
  | 'budget_exhausted';

const REASON_GROUP: Record<string, NoWinnerReason> = {
  ads_disabled_for_plan: 'ads_disabled',
  user_opted_out: 'ads_disabled',
  session_ad_limit: 'frequency_capped',
  frequency_cap_hour: 'frequency_capped',
  frequency_cap_day: 'frequency_capped',
  country_excluded: 'audience_excluded',
  persona_excluded: 'audience_excluded',
  model_excluded: 'audience_excluded',
  commercial_intent_too_low: 'audience_excluded',
  onchain_signals_missing: 'onchain_required',
  onchain_criteria_unmet: 'onchain_required',
  budget_exhausted: 'budget_exhausted',
  daily_cap_reached: 'budget_exhausted',
  not_started: 'no_campaigns',
  ended: 'no_campaigns',
};

/** Ordered most to least informative when campaigns failed for different reasons. */
const REASON_PRIORITY: NoWinnerReason[] = [
  'ads_disabled',
  'frequency_capped',
  'onchain_required',
  'audience_excluded',
  'budget_exhausted',
  'no_campaigns',
];

export function explainNoWinner(
  candidates: CandidateCampaign[],
  ctx: AdRequestContext,
  weights: ScoringWeights,
  maxAdsPerSession: number,
): NoWinnerReason {
  if (candidates.length === 0) return 'no_campaigns';

  const failures = new Set<NoWinnerReason>();
  let anyEligible = false;

  for (const candidate of candidates) {
    const verdict = checkEligibility(candidate, ctx, maxAdsPerSession);
    if (verdict.eligible) {
      anyEligible = true;
      continue;
    }
    failures.add(REASON_GROUP[verdict.reason ?? ''] ?? 'no_campaigns');
  }

  // Something could have run and still did not score highly enough: that is the
  // relevance floor doing its job, and it is the answer the caller wants.
  if (anyEligible) return 'below_relevance_floor';

  return REASON_PRIORITY.find((reason) => failures.has(reason)) ?? 'no_campaigns';
}

/**
 * Is this campaign bidding for anyone at all?
 *
 * A campaign that named no intents, no technologies, no interests and no
 * persona has not asked for a particular developer — it is buying attention,
 * not an audience. That is the only kind of campaign allowed to fill a slot no
 * targeted campaign wanted.
 */
export function isUntargeted(campaign: CandidateCampaign): boolean {
  const t = campaign.targeting;
  return (
    t.aiIntents.length === 0 &&
    t.intentCategories.length === 0 &&
    t.technologies.length === 0 &&
    t.interests.length === 0 &&
    t.personas.length === 0 &&
    t.onchainMode !== 'require'
  );
}

/**
 * The unsold slot.
 *
 * Called only when nothing cleared the relevance floor. Eligibility still
 * applies in full — budget, frequency, country, dates — so this fills a gap, it
 * does not bypass the rules. Highest bid wins, because with relevance out of
 * the picture that is all that is left to rank on.
 */
export function selectRemnant(
  candidates: CandidateCampaign[],
  ctx: AdRequestContext,
  maxAdsPerSession: number,
  rotation: RotationOptions = {},
): RankedCandidate | null {
  const eligible = candidates
    .filter(isUntargeted)
    .filter((c) => checkEligibility(c, ctx, maxAdsPerSession).eligible);

  if (eligible.length === 0) return null;

  /**
   * Rotation matters more here than anywhere else in the auction.
   *
   * This is the slot that fills when a developer asks something no campaign
   * targeted, which in a real conversation is most turns — so without rotation
   * one brand campaign appears on every one of them in a row. There is no
   * relevance to trade away in doing it: nothing here won on relevance, and the
   * score recorded below says exactly that.
   *
   * Highest bid still leads, since with relevance out of the picture it is all
   * there is to rank on. It just no longer gets to win the same slot twice in a
   * row while another brand is waiting and able to pay.
   */
  const justShown = rotation.recentCampaignIds?.[0];
  const notRepeating = eligible.filter((c) => c.campaignId !== justShown);
  const pool = notRepeating.length > 0 ? notRepeating : eligible;

  const seen = new Set(rotation.recentCampaignIds ?? []);
  const fresh = pool.filter((c) => !seen.has(c.campaignId));
  const choices = fresh.length > 0 ? fresh : pool;

  const topBid = choices.reduce((m, c) => (c.bidMicro > m ? c.bidMicro : m), 0n);
  const leaders = choices.filter((c) => c.bidMicro === topBid);
  const roll = rotation.seed === undefined ? 0 : seededUnitInterval(rotation.seed);
  const winner = leaders[Math.min(leaders.length - 1, Math.floor(roll * leaders.length))]!;

  return {
    campaign: winner,
    // Zeroed deliberately: this campaign won nothing on relevance, and the
    // analytics should never suggest otherwise.
    score: {
      intentMatch: 0,
      audienceMatch: 0,
      onchainMatch: 0,
      bidWeight: 1,
      frequencyPenalty: 0,
      fraudPenalty: 0,
      total: 0,
    },
    reasons: ['untargeted_brand_campaign'],
  };
}

/**
 * A number in [0,1) derived from a string, so a choice can vary between
 * requests without varying between two evaluations of the same request.
 *
 * `Math.random` would make the auction unreproducible: the same request would
 * produce a different ad on a retry, and an advertiser asking why they lost
 * could not be answered. Seeding on the request id keeps every property the
 * deterministic engine was built for — replay a request id, get the same
 * winner — while letting the *next* request land somewhere else.
 *
 * FNV-1a. Not cryptographic; it only has to spread evenly and cheaply.
 */
export function seededUnitInterval(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/**
 * How close to the leader a candidate has to score to be considered its equal.
 *
 * Inside this band the engine is saying "these are about as relevant as each
 * other", and which one runs is not a relevance judgement any more. Picking the
 * same one every time is what made a session show one advertiser back to back;
 * rotating within the band costs the developer nothing in relevance and stops
 * the slot looking broken.
 */
export const ROTATION_BAND = 0.05;

export interface RotationOptions {
  /**
   * Campaigns already shown in this conversation, most recent first. The most
   * recent is skipped outright when there is anything else to run; the rest
   * only lose ties.
   */
  recentCampaignIds?: readonly string[];
  /** Varies the pick between requests while keeping each request reproducible. */
  seed?: string;
}

/**
 * Chooses among candidates the ranking already judged equivalent.
 *
 * Relevance still decides the band — nothing outside `ROTATION_BAND` of the
 * leader can win here, so a weak ad never displaces a strong one. Within it,
 * two rules apply in order: an advertiser is not repeated immediately if there
 * is any alternative, and among what is left the seed decides. That is enough
 * to stop the same card appearing on three consecutive turns without making the
 * result unexplainable.
 */
export function rotateWinner(
  ranked: readonly RankedCandidate[],
  options: RotationOptions = {},
): RankedCandidate | null {
  if (ranked.length === 0) return null;

  /**
   * No campaign runs twice in a row while anything else cleared the floor.
   *
   * This is applied to the whole ranked list rather than inside the band, and
   * that is the deliberate part. A campaign that leads by more than
   * `ROTATION_BAND` would otherwise win every turn of a conversation about the
   * subject it targets — which is exactly what the auction says *should*
   * happen, and exactly what reads to a developer as the product being stuck.
   * The runner-up still had to clear the relevance floor to be here at all, so
   * standing it in for one turn costs relevance that was already good enough to
   * show, and buys a session that does not look broken.
   */
  const justShown = options.recentCampaignIds?.[0];
  const running =
    justShown === undefined
      ? ranked
      : (() => {
          const without = ranked.filter((r) => r.campaign.campaignId !== justShown);
          // An empty slot is a worse outcome than a repeat.
          return without.length > 0 ? without : ranked;
        })();

  const leader = running[0]!;
  const band = running.filter((r) => leader.score.total - r.score.total <= ROTATION_BAND);
  if (band.length === 1) return leader;

  // Everything else seen earlier in the conversation is deprioritised but never
  // excluded — with a small pool that would empty the slot.
  const seen = new Set(options.recentCampaignIds ?? []);
  const fresh = band.filter((r) => !seen.has(r.campaign.campaignId));
  const choices = fresh.length > 0 ? fresh : band;

  const roll = options.seed === undefined ? 0 : seededUnitInterval(options.seed);
  return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))] ?? leader;
}

/** Convenience for the ad module: the winner, or null when nothing is relevant enough. */
export function selectWinner(
  candidates: CandidateCampaign[],
  ctx: AdRequestContext,
  weights: ScoringWeights,
  maxAdsPerSession: number,
): RankedCandidate | null {
  return rankCandidates(candidates, ctx, weights, maxAdsPerSession)[0] ?? null;
}
