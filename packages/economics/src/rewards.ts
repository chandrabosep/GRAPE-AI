import { type Allocation, type EconomicsConfig, splitMicro } from '@aam/shared';

/**
 * Reward accounting.
 *
 * Two rules shape everything here. First, the user is paid out of what the
 * advertiser was actually charged, so the platform can never pay out money it
 * did not collect. Second, a reward requires *qualified* attention: an
 * impression the client confirmed was on screen, not merely selected. Anything
 * that would pay a user for spamming prompts is rejected before it reaches the
 * ledger.
 */

export interface AllocationResult {
  rewardMicro: bigint;
  platformMicro: bigint;
  treasuryMicro: bigint;
}

/** Splits a charge into its three shares. Always sums back to `chargeMicro` exactly. */
export function allocateCharge(chargeMicro: bigint, allocation: Allocation): AllocationResult {
  const parts = splitMicro(chargeMicro, {
    reward: allocation.reward,
    platform: allocation.platform,
    treasury: allocation.treasury,
  });
  return {
    rewardMicro: parts.reward ?? 0n,
    platformMicro: parts.platform ?? 0n,
    treasuryMicro: parts.treasury ?? 0n,
  };
}

export function impressionCharge(bidMicro: bigint): bigint {
  return bidMicro;
}

/** A click is worth more to the advertiser, so it is worth more to the user too. */
export function clickCharge(bidMicro: bigint, clickMultiplier: number): bigint {
  return (bidMicro * BigInt(Math.round(clickMultiplier * 100))) / 100n;
}

export type RewardRejection =
  | 'not_qualified'
  | 'duplicate_prompt'
  | 'too_soon'
  | 'daily_cap_reached'
  | 'fraud_score_too_high'
  | 'already_rewarded'
  | 'click_without_view'
  | 'click_limit_reached';

export interface RewardEligibilityInput {
  /** The client confirmed the card was visible for the required dwell time. */
  viewConfirmed: boolean;
  alreadyRewarded: boolean;
  /** Same normalised prompt seen inside the duplicate window. */
  duplicatePrompt: boolean;
  secondsSinceLastRewardedImpression: number | null;
  rewardedTodayMicro: bigint;
  worldVerified: boolean;
  fraudScore: number;
}

export interface RewardDecision {
  ok: boolean;
  reason?: RewardRejection;
  /** Reward is trimmed rather than refused when it would cross the daily cap. */
  cappedAtMicro?: bigint;
}

export const FRAUD_REWARD_THRESHOLD = 0.8;

export function dailyRewardCapMicro(config: EconomicsConfig, worldVerified: boolean): bigint {
  return BigInt(
    worldVerified ? config.caps.userDailyRewardMicroVerified : config.caps.userDailyRewardMicro,
  );
}

/**
 * Decides whether a qualified impression may be paid, and for how much.
 * Deterministic and cheap on purpose: this runs on every impression.
 */
export function evaluateImpressionReward(
  input: RewardEligibilityInput,
  proposedRewardMicro: bigint,
  config: EconomicsConfig,
): RewardDecision {
  if (!input.viewConfirmed) return { ok: false, reason: 'not_qualified' };
  if (input.alreadyRewarded) return { ok: false, reason: 'already_rewarded' };
  if (input.duplicatePrompt) return { ok: false, reason: 'duplicate_prompt' };
  if (input.fraudScore > FRAUD_REWARD_THRESHOLD) {
    return { ok: false, reason: 'fraud_score_too_high' };
  }

  const minGap = config.caps.minSecondsBetweenRewardedImpressions;
  if (
    input.secondsSinceLastRewardedImpression !== null &&
    input.secondsSinceLastRewardedImpression < minGap
  ) {
    return { ok: false, reason: 'too_soon' };
  }

  const cap = dailyRewardCapMicro(config, input.worldVerified);
  const remaining = cap - input.rewardedTodayMicro;
  if (remaining <= 0n) return { ok: false, reason: 'daily_cap_reached' };

  if (proposedRewardMicro > remaining) {
    return { ok: true, cappedAtMicro: remaining };
  }
  return { ok: true, cappedAtMicro: proposedRewardMicro };
}

export interface ClickRewardInput extends RewardEligibilityInput {
  clicksRewardedTodayForCampaign: number;
}

/** A click only counts after the impression it belongs to was confirmed visible. */
export function evaluateClickReward(
  input: ClickRewardInput,
  proposedRewardMicro: bigint,
  config: EconomicsConfig,
): RewardDecision {
  if (!input.viewConfirmed) return { ok: false, reason: 'click_without_view' };
  if (input.clicksRewardedTodayForCampaign >= config.engagement.maxClickRewardsPerCampaignPerDay) {
    return { ok: false, reason: 'click_limit_reached' };
  }
  return evaluateImpressionReward({ ...input, alreadyRewarded: false }, proposedRewardMicro, config);
}
