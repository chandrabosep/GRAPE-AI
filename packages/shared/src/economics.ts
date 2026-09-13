import { z } from 'zod';

/**
 * Every number that decides who gets paid lives here, not in business logic.
 *
 * Loaded from economics.json at boot and exposed read-only at
 * GET /api/v1/config/public so the dashboards and the extension render the
 * same numbers the engine used. Campaigns snapshot `allocation` at activation,
 * so changing this file never rewrites the economics of a live campaign.
 */

const ratio = z.number().min(0).max(1);

export const allocationSchema = z
  .object({
    reward: ratio,
    platform: ratio,
    treasury: ratio,
  })
  .refine((a) => Math.abs(a.reward + a.platform + a.treasury - 1) < 1e-9, {
    message: 'allocation must sum to exactly 1',
  });
export type Allocation = z.infer<typeof allocationSchema>;

/**
 * The earning ladder.
 *
 * A developer's share of a charge is not fixed at the campaign's split. It
 * rises with the attention they have actually been paid for, across three
 * levels named for the vine they are growing: Bud, Vine, Reserve.
 *
 * The extra share is carved out of the platform's, never added to the
 * advertiser's bill. A campaign is charged exactly the same whoever happens to
 * see it, so a tier can never make an impression cost more than was bid for it
 * — which is the same invariant that stops the platform paying out money it
 * did not collect.
 */
export const tierSchema = z.object({
  /** 1-based rung, contiguous from the bottom. */
  level: z.number().int().min(1),
  /** What the developer is called at this rung. */
  name: z.string().min(1),
  /** One line of explanation, rendered on the dashboard beside the name. */
  blurb: z.string().min(1),
  /** Lifetime granted rewards needed to stand here. The first rung is always 0. */
  minRewards: z.number().int().nonnegative(),
  /**
   * The developer's share of every charge at this rung.
   *
   * Absolute rather than a bonus, so the number written here is the number
   * shown on the dashboard, and a campaign that snapshotted a more generous
   * split than the ladder keeps it.
   */
  rewardShare: ratio,
  /**
   * Scales the daily reward ceiling at this rung.
   *
   * Without it the ladder is decorative for exactly the people who climbed it:
   * a heavy user reaches the same daily cap either way, so a larger share of
   * each charge buys them nothing on the days it would have mattered.
   */
  dailyCapMultiplier: z.number().min(1),
});
export type Tier = z.infer<typeof tierSchema>;

export const tiersSchema = z
  .array(tierSchema)
  .min(1)
  .refine((tiers) => tiers[0].minRewards === 0, {
    message: 'the lowest tier must start at zero rewards',
  })
  .refine((tiers) => tiers.every((tier, i) => tier.level === i + 1), {
    message: 'tier levels must be contiguous and start at 1',
  })
  .refine(
    (tiers) =>
      tiers.every(
        (tier, i) =>
          i === 0 ||
          (tier.minRewards > tiers[i - 1].minRewards &&
            tier.rewardShare >= tiers[i - 1].rewardShare &&
            tier.dailyCapMultiplier >= tiers[i - 1].dailyCapMultiplier),
      ),
    { message: 'each tier must be harder to reach and never pay less than the one below it' },
  );

export const scoringWeightsSchema = z.object({
  intent: z.number().min(0),
  audience: z.number().min(0),
  onchain: z.number().min(0),
  bid: z.number().min(0),
  frequency: z.number().min(0),
  fraud: z.number().min(0),
  /** Below this score we show no ad at all. An irrelevant ad is worse than none. */
  minScore: z.number().min(0).max(1),
});
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

export const modelPricingSchema = z.object({
  inputMicroPerToken: z.number().nonnegative(),
  outputMicroPerToken: z.number().nonnegative(),
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

/**
 * One slot's economics.
 *
 * `minScore` is the relevance floor for that slot, and the two are not the same
 * number for a reason. The banner is ranked from the refined LLM intent and
 * takes a whole card; it should stay expensive to win. The inline line is
 * ranked from the fast rules pass — which caps its own confidence at 0.7, and
 * the scorer multiplies the intent term by `(0.5 + 0.5 * confidence)` — so the
 * same floor asks the cheaper, smaller slot to clear a bar while carrying worse
 * information about the request. In practice that left the line empty on almost
 * every turn and the caret blinking in its place. A lower floor here is the slot
 * being judged on its own terms, not the relevance rule being relaxed.
 *
 * There is a hard lower bound on the inline floor, and it is not a matter of
 * taste. An untargeted campaign scores `audience * NEUTRAL_AUDIENCE + bid`,
 * which at the current weights is `0.15 * 0.5 + 0.15 * 1 = 0.225` when it is
 * the sole bidder. A floor at or below that lets a brand campaign win an
 * auction on *relevance* rather than as the unsold slot — which would put a
 * targeted developer's line in the hands of a campaign that asked for nobody,
 * and bypass `selectRemnant` and its `unsold_slot` label entirely. Any value
 * here must stay above 0.225 while the weights are what they are; 0.28 leaves
 * room on both sides, since a genuinely matched intent scores 0.30 and up
 * across the whole rules-pass confidence band. `scoring.test.ts` pins this.
 */
const formatEconomicsSchema = z.object({
  bidMultiplier: z.number().positive(),
  minScore: z.number().min(0).max(1),
});

export const economicsConfigSchema = z.object({
  allocation: allocationSchema,
  /** The ladder a developer climbs. Ordered from the bottom rung up. */
  tiers: tiersSchema,
  weights: scoringWeightsSchema,
  engagement: z.object({
    /** A click is worth this many impressions to the advertiser, and to the user. */
    clickMultiplier: z.number().min(1),
    maxClickRewardsPerCampaignPerDay: z.number().int().min(0),
  }),
  credits: z.object({
    /** One-time grant on signup. Without it a new user cannot reach their first ad. */
    starterGrantMicro: z.number().int().nonnegative(),
    /** Withdrawals below this are not worth a transaction fee. */
    minPayoutMicro: z.number().int().nonnegative(),
    /**
     * Upper bound on a single inference request.
     *
     * Sized for a tool-using turn, not a bare chat message. A hop that has read
     * several files legitimately carries tens of thousands of prompt tokens, and
     * this cap is what `authorizeSpend` clamps the answer length against — set
     * too low it does not refuse the request, it silently truncates the reply
     * mid-sentence, which reads as the model breaking rather than as a limit.
     */
    maxRequestCostMicro: z.number().int().positive(),
  }),
  caps: z.object({
    userDailyRewardMicro: z.number().int().nonnegative(),
    userDailyRewardMicroVerified: z.number().int().nonnegative(),
    maxAdsPerSession: z.number().int().nonnegative(),
    minSecondsBetweenRewardedImpressions: z.number().int().nonnegative(),
    /** Identical prompts inside this window earn nothing. */
    duplicatePromptWindowSeconds: z.number().int().nonnegative(),
  }),
  /**
   * What happens to a slot no targeted campaign wanted.
   *
   * Off, the slot stays empty — the strictest reading of "an irrelevant ad is
   * worse than none". On, it is offered to campaigns that asked for no
   * targeting at all (brand campaigns bidding for any developer), which is what
   * an unsold slot is worth in a real market. A targeted campaign can never
   * win this way, so a developer is still never shown an ad aimed at someone
   * they are not.
   */
  remnant: z.object({
    enabled: z.boolean(),
    /** Recorded on the impression so remnant fills are separable in analytics. */
    label: z.string().min(1),
  }),
  /**
   * Per-format economics.
   *
   * The inline slot is one line beside a streaming answer; the banner is a card
   * the developer stops and reads. They are not the same unit of attention, so
   * they do not cost the advertiser the same. The multiplier scales the bid for
   * that slot, which scales the reward with it — the split is untouched, so a
   * developer still earns the same share of whatever was actually charged.
   */
  formats: z.object({
    banner: formatEconomicsSchema,
    inline: formatEconomicsSchema,
  }),
  models: z.record(z.string(), modelPricingSchema),
  signalCacheHours: z.number().positive(),
});
export type EconomicsConfig = z.infer<typeof economicsConfigSchema>;

/** Used by tests and as the shape reference for economics.json. */
export const DEFAULT_ECONOMICS: EconomicsConfig = {
  allocation: { reward: 0.7, platform: 0.2, treasury: 0.1 },
  tiers: [
    {
      level: 1,
      name: 'Bud',
      blurb: 'Where every vine starts. The campaign\u2019s own split, nothing taken off it.',
      minRewards: 0,
      rewardShare: 0.7,
      dailyCapMultiplier: 1,
    },
    {
      level: 2,
      name: 'Vine',
      blurb: 'Established and producing. A larger share, and more room to earn in a day.',
      minRewards: 25,
      rewardShare: 0.78,
      dailyCapMultiplier: 1.5,
    },
    {
      level: 3,
      name: 'Reserve',
      blurb: 'The best of the harvest. The most the platform can give up and still run.',
      minRewards: 100,
      rewardShare: 0.85,
      dailyCapMultiplier: 2,
    },
  ],
  credits: {
    starterGrantMicro: 500_000,
    minPayoutMicro: 1_000_000,
    maxRequestCostMicro: 400_000,
  },
  weights: {
    intent: 0.4,
    audience: 0.15,
    onchain: 0.2,
    bid: 0.15,
    frequency: 0.05,
    fraud: 0.05,
    minScore: 0.35,
  },
  engagement: { clickMultiplier: 3, maxClickRewardsPerCampaignPerDay: 1 },
  caps: {
    userDailyRewardMicro: 200_000,
    userDailyRewardMicroVerified: 500_000,
    maxAdsPerSession: 10,
    minSecondsBetweenRewardedImpressions: 60,
    duplicatePromptWindowSeconds: 600,
  },
  remnant: { enabled: true, label: 'unsold_slot' },
  formats: {
    banner: { bidMultiplier: 1, minScore: 0.35 },
    inline: { bidMultiplier: 0.3, minScore: 0.28 },
  },
  models: {},
  signalCacheHours: 6,
};
