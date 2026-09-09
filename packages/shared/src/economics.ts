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

export const economicsConfigSchema = z.object({
  allocation: allocationSchema,
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
    /** Upper bound on a single inference request, so one prompt cannot drain a balance. */
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
  models: z.record(z.string(), modelPricingSchema),
  signalCacheHours: z.number().positive(),
});
export type EconomicsConfig = z.infer<typeof economicsConfigSchema>;

/** Used by tests and as the shape reference for economics.json. */
export const DEFAULT_ECONOMICS: EconomicsConfig = {
  allocation: { reward: 0.7, platform: 0.2, treasury: 0.1 },
  credits: {
    starterGrantMicro: 500_000,
    minPayoutMicro: 1_000_000,
    maxRequestCostMicro: 100_000,
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
  models: {},
  signalCacheHours: 6,
};
