import type { Allocation, EconomicsConfig, Tier } from '@aam/shared';

/**
 * The earning ladder.
 *
 * The product's promise to a developer is that their attention is worth
 * something. The ladder is the second half of that promise: attention is worth
 * *more* to someone who keeps giving it, because a developer who has been
 * showing up for a month is the inventory an advertiser actually wants.
 *
 * Two rules keep it honest, and they are the same two the reward accounting
 * already runs on. A tier never changes what an advertiser is charged — the
 * extra share comes out of the platform's cut, so the money still exists before
 * it is paid. And progress is counted in *granted rewards*, not in impressions
 * served or prompts sent: every abuse gate in `rewards.ts` has already run by
 * the time a reward is granted, so the only way to climb is the way the product
 * is meant to be used.
 */

/**
 * Where a developer stands, and how far the next rung is.
 *
 * Carries the neighbouring tier rather than just the current one because every
 * caller that shows a tier also wants to show what comes next — a ladder with
 * no visible next rung is just a label.
 */
export interface TierStanding {
  tier: Tier;
  /** null on the top rung. */
  next: Tier | null;
  rewardCount: number;
  /** Rewards still needed to reach `next`; 0 on the top rung. */
  toNext: number;
  /** 0..1 through the current rung. 1 on the top rung. */
  progress: number;
}

/**
 * The highest rung this many granted rewards has reached.
 *
 * Counting lifetime rewards rather than a rolling window is deliberate: a rung
 * once climbed is never lost. A ladder that can demote turns a good week into a
 * worse rate later, which is the opposite of what it is for, and it would make
 * the number on the dashboard something a developer has to keep watching rather
 * than something they have earned.
 */
export function resolveTier(config: EconomicsConfig, rewardCount: number): Tier {
  let current = config.tiers[0];
  for (const tier of config.tiers) {
    if (rewardCount >= tier.minRewards) current = tier;
  }
  return current;
}

/** The rung above this one, or null at the top. */
export function nextTier(config: EconomicsConfig, tier: Tier): Tier | null {
  return config.tiers.find((t) => t.level === tier.level + 1) ?? null;
}

export function tierStanding(config: EconomicsConfig, rewardCount: number): TierStanding {
  const tier = resolveTier(config, rewardCount);
  const next = nextTier(config, tier);

  if (!next) {
    return { tier, next: null, rewardCount, toNext: 0, progress: 1 };
  }

  const span = next.minRewards - tier.minRewards;
  const done = Math.max(0, rewardCount - tier.minRewards);

  return {
    tier,
    next,
    rewardCount,
    toNext: Math.max(0, next.minRewards - rewardCount),
    progress: span <= 0 ? 1 : Math.min(1, done / span),
  };
}

/**
 * Re-splits a campaign's allocation for a developer standing at `tier`.
 *
 * The developer's share is raised to the tier's, and the platform's is reduced
 * by exactly the same amount. The total is untouched, which is what lets this
 * be applied to a charge that has already been reserved against a campaign's
 * budget: the advertiser paid what they bid, and only the division of it moved.
 *
 * Two guards matter. The bonus can never exceed the platform's own share, so a
 * split the platform cannot fund is clamped rather than taking from the
 * treasury — the treasury is what settles rewards on chain, and borrowing from
 * it to pay a reward would be circular. And a campaign that snapshotted a more
 * generous split than the ladder keeps it: the tier is a floor on what a
 * developer earns, never a ceiling.
 */
export function applyTier(allocation: Allocation, tier: Tier): Allocation {
  const ceiling = allocation.reward + allocation.platform;
  const target = Math.min(tier.rewardShare, ceiling);
  const bonus = Math.max(0, target - allocation.reward);

  if (bonus === 0) return allocation;

  return {
    reward: allocation.reward + bonus,
    platform: allocation.platform - bonus,
    treasury: allocation.treasury,
  };
}
