import { DEFAULT_ECONOMICS, type Allocation, type EconomicsConfig } from '@aam/shared';
import { describe, expect, it } from 'vitest';
import { allocateCharge } from './rewards';
import { applyTier, nextTier, resolveTier, tierStanding } from './tiers';

const CONFIG: EconomicsConfig = DEFAULT_ECONOMICS;
const [BUD, VINE, RESERVE] = CONFIG.tiers;

const BASE: Allocation = { reward: 0.7, platform: 0.2, treasury: 0.1 };

describe('resolving a tier', () => {
  it('starts a brand-new developer on the bottom rung', () => {
    expect(resolveTier(CONFIG, 0)).toEqual(BUD);
  });

  it('promotes exactly at the threshold, not after it', () => {
    expect(resolveTier(CONFIG, VINE.minRewards - 1)).toEqual(BUD);
    expect(resolveTier(CONFIG, VINE.minRewards)).toEqual(VINE);
  });

  it('stops at the top rung however far past it a developer goes', () => {
    expect(resolveTier(CONFIG, RESERVE.minRewards * 1_000)).toEqual(RESERVE);
    expect(nextTier(CONFIG, RESERVE)).toBeNull();
  });

  it('never pays less on a higher rung', () => {
    for (let i = 1; i < CONFIG.tiers.length; i += 1) {
      expect(CONFIG.tiers[i].rewardShare).toBeGreaterThanOrEqual(CONFIG.tiers[i - 1].rewardShare);
    }
  });
});

describe('standing', () => {
  it('reports the distance to the next rung', () => {
    const standing = tierStanding(CONFIG, VINE.minRewards - 5);
    expect(standing.tier).toEqual(BUD);
    expect(standing.next).toEqual(VINE);
    expect(standing.toNext).toBe(5);
    expect(standing.progress).toBeGreaterThan(0);
    expect(standing.progress).toBeLessThan(1);
  });

  it('is complete and has nowhere left to go at the top', () => {
    const standing = tierStanding(CONFIG, RESERVE.minRewards);
    expect(standing.next).toBeNull();
    expect(standing.toNext).toBe(0);
    expect(standing.progress).toBe(1);
  });
});

describe('applying a tier to a split', () => {
  it('leaves the bottom rung on the campaign’s own split', () => {
    expect(applyTier(BASE, BUD)).toEqual(BASE);
  });

  it('takes the bonus from the platform and never from the advertiser', () => {
    const split = applyTier(BASE, RESERVE);
    expect(split.reward).toBeCloseTo(RESERVE.rewardShare, 9);
    expect(split.treasury).toBe(BASE.treasury);
    expect(split.reward + split.platform + split.treasury).toBeCloseTo(1, 9);
  });

  // splitMicro refuses ratios that do not sum to one, so a tier that drifted
  // off 1.0 by float error would not misprice a reward, it would throw on the
  // ack of every impression.
  it('produces a split the allocator still accepts', () => {
    for (const tier of CONFIG.tiers) {
      const result = allocateCharge(10_000n, applyTier(BASE, tier));
      expect(result.rewardMicro + result.platformMicro + result.treasuryMicro).toBe(10_000n);
    }
  });

  it('pays a higher rung more out of the same charge', () => {
    const bud = allocateCharge(10_000n, applyTier(BASE, BUD));
    const reserve = allocateCharge(10_000n, applyTier(BASE, RESERVE));
    expect(reserve.rewardMicro).toBeGreaterThan(bud.rewardMicro);
    expect(reserve.platformMicro).toBeLessThan(bud.platformMicro);
    expect(reserve.treasuryMicro).toBe(bud.treasuryMicro);
  });

  it('clamps rather than borrowing from the treasury', () => {
    const thin: Allocation = { reward: 0.7, platform: 0.05, treasury: 0.25 };
    const split = applyTier(thin, RESERVE);
    expect(split.platform).toBeCloseTo(0, 9);
    expect(split.reward).toBeCloseTo(0.75, 9);
    expect(split.treasury).toBe(0.25);
  });

  it('keeps a campaign that was already more generous than the ladder', () => {
    const generous: Allocation = { reward: 0.9, platform: 0.05, treasury: 0.05 };
    expect(applyTier(generous, BUD)).toEqual(generous);
    expect(applyTier(generous, RESERVE)).toEqual(generous);
  });
});
