import { DEFAULT_ECONOMICS, type EconomicsConfig } from '@aam/shared';
import { describe, expect, it } from 'vitest';
import {
  allocateCharge,
  clickCharge,
  dailyRewardCapMicro,
  evaluateClickReward,
  evaluateImpressionReward,
  type RewardEligibilityInput,
} from './rewards';

const CONFIG: EconomicsConfig = DEFAULT_ECONOMICS;

function input(overrides: Partial<RewardEligibilityInput> = {}): RewardEligibilityInput {
  return {
    viewConfirmed: true,
    alreadyRewarded: false,
    duplicatePrompt: false,
    secondsSinceLastRewardedImpression: null,
    rewardedTodayMicro: 0n,
    worldVerified: false,
    fraudScore: 0,
    ...overrides,
  };
}

describe('allocation', () => {
  it('splits a charge by the configured ratios', () => {
    const result = allocateCharge(10_000n, { reward: 0.7, platform: 0.2, treasury: 0.1 });
    expect(result).toEqual({ rewardMicro: 7_000n, platformMicro: 2_000n, treasuryMicro: 1_000n });
  });

  it('never loses or invents a micro-unit when rounding', () => {
    for (const charge of [1n, 3n, 7n, 999n, 1_001n, 123_457n]) {
      const { rewardMicro, platformMicro, treasuryMicro } = allocateCharge(charge, {
        reward: 0.7,
        platform: 0.2,
        treasury: 0.1,
      });
      expect(rewardMicro + platformMicro + treasuryMicro).toBe(charge);
    }
  });

  it('honours a completely different split without code changes', () => {
    const result = allocateCharge(1_000n, { reward: 0.5, platform: 0.5, treasury: 0 });
    expect(result).toEqual({ rewardMicro: 500n, platformMicro: 500n, treasuryMicro: 0n });
  });

  it('rejects ratios that do not sum to one', () => {
    expect(() => allocateCharge(100n, { reward: 0.7, platform: 0.2, treasury: 0.2 })).toThrow();
  });
});

describe('click pricing', () => {
  it('multiplies the bid for a click', () => {
    expect(clickCharge(10_000n, 3)).toBe(30_000n);
    expect(clickCharge(10_000n, 1.5)).toBe(15_000n);
  });
});

describe('impression reward eligibility', () => {
  it('pays a confirmed, unique, well-spaced impression', () => {
    expect(evaluateImpressionReward(input(), 7_000n, CONFIG)).toEqual({
      ok: true,
      cappedAtMicro: 7_000n,
    });
  });

  it('refuses to pay for an ad that was never seen', () => {
    expect(evaluateImpressionReward(input({ viewConfirmed: false }), 7_000n, CONFIG).reason).toBe(
      'not_qualified',
    );
  });

  it('refuses to pay twice for the same impression', () => {
    expect(evaluateImpressionReward(input({ alreadyRewarded: true }), 7_000n, CONFIG).reason).toBe(
      'already_rewarded',
    );
  });

  it('does not reward a repeated prompt', () => {
    expect(evaluateImpressionReward(input({ duplicatePrompt: true }), 7_000n, CONFIG).reason).toBe(
      'duplicate_prompt',
    );
  });

  it('enforces a minimum gap between paid impressions', () => {
    const decision = evaluateImpressionReward(
      input({ secondsSinceLastRewardedImpression: 5 }),
      7_000n,
      CONFIG,
    );
    expect(decision.reason).toBe('too_soon');
  });

  it('stops paying a user flagged for abuse', () => {
    expect(evaluateImpressionReward(input({ fraudScore: 0.95 }), 7_000n, CONFIG).reason).toBe(
      'fraud_score_too_high',
    );
  });

  it('trims the last reward of the day to the cap instead of refusing it', () => {
    const cap = dailyRewardCapMicro(CONFIG, false);
    const decision = evaluateImpressionReward(
      input({ rewardedTodayMicro: cap - 1_000n }),
      7_000n,
      CONFIG,
    );
    expect(decision).toEqual({ ok: true, cappedAtMicro: 1_000n });
  });

  it('refuses once the cap is fully spent', () => {
    const cap = dailyRewardCapMicro(CONFIG, false);
    expect(
      evaluateImpressionReward(input({ rewardedTodayMicro: cap }), 7_000n, CONFIG).reason,
    ).toBe('daily_cap_reached');
  });

  it('gives verified humans a higher daily ceiling', () => {
    expect(dailyRewardCapMicro(CONFIG, true)).toBeGreaterThan(dailyRewardCapMicro(CONFIG, false));
  });
});

describe('click reward eligibility', () => {
  it('ignores a click on an impression that was never confirmed visible', () => {
    const decision = evaluateClickReward(
      { ...input({ viewConfirmed: false }), clicksRewardedTodayForCampaign: 0 },
      21_000n,
      CONFIG,
    );
    expect(decision.reason).toBe('click_without_view');
  });

  it('pays only the first click per campaign per day', () => {
    const decision = evaluateClickReward(
      { ...input(), clicksRewardedTodayForCampaign: 1 },
      21_000n,
      CONFIG,
    );
    expect(decision.reason).toBe('click_limit_reached');
  });
});
