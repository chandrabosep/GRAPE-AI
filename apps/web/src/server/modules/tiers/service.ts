import { prisma } from '@aam/db';
import { tierStanding, type TierStanding } from '@aam/economics';
import { economics } from '../../config/index';

/**
 * Where a developer stands on the earning ladder.
 *
 * Standing is *derived*, never stored. The rewards table already records every
 * granted reward, and it is the same table the daily cap and the spacing rule
 * are read from — giving the ladder its own counter column would create a
 * second answer to "how much has this person earned from attention", and the
 * two would disagree the first time a reward was reversed. One indexed count is
 * cheaper than reconciling them.
 *
 * Reversed rewards are excluded for the same reason they are excluded from the
 * daily total: a reward that was rolled back was never paid, so it cannot buy
 * progress up the ladder either.
 */
export async function getTierStanding(userId: string): Promise<TierStanding> {
  const rewardCount = await prisma.reward.count({
    where: { userId, status: 'granted' },
  });
  return tierStanding(economics(), rewardCount);
}
