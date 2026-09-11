import { prisma } from '@aam/db';
import { economics } from '../../config/index';

/**
 * Deterministic abuse rules.
 *
 * Paying people for attention invites farming, so rewards are gated on evidence
 * rather than on an ad having been selected. Everything here is a simple counted
 * rule on purpose: it must be explainable to an advertiser asking what they paid
 * for, and cheap enough to run on every impression.
 *
 * Nothing here blocks an answer. The worst outcome for a flagged account is that
 * it keeps using the product but stops earning.
 */

export interface AbuseSignals {
  rewardedTodayMicro: bigint;
  secondsSinceLastRewardedImpression: number | null;
  duplicatePrompt: boolean;
  fraudScore: number;
  worldVerified: boolean;
}

function startOfUtcDay(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Gathers everything the reward rules need, in one round trip per fact.
 *
 * `exceptRequestId` excludes rewards already granted for the same answer. The
 * spacing rule exists to stop someone farming by firing off prompts back to
 * back, and a single answer now carries two sponsored slots — an inline line
 * and a card. Both were genuinely shown and both genuinely charged an
 * advertiser, so counting the first against the second would leave the platform
 * collecting money it never paid out.
 */
export async function collectAbuseSignals(
  userId: string,
  promptHash: string | null,
  exceptRequestId?: string | null,
): Promise<AbuseSignals> {
  const config = economics();
  const dayStart = startOfUtcDay();

  const [todayAggregate, lastReward, user, duplicateCount] = await Promise.all([
    prisma.reward.aggregate({
      where: { userId, status: 'granted', createdAt: { gte: dayStart } },
      _sum: { amountMicro: true },
    }),
    prisma.reward.findFirst({
      where: {
        userId,
        status: 'granted',
        ...(exceptRequestId ? { impression: { requestId: { not: exceptRequestId } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { fraudScore: true, worldVerified: true },
    }),
    promptHash
      ? prisma.aiIntentRecord.count({
          where: {
            userId,
            promptHash,
            createdAt: {
              gte: new Date(Date.now() - config.caps.duplicatePromptWindowSeconds * 1000),
            },
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    rewardedTodayMicro: todayAggregate._sum.amountMicro ?? 0n,
    secondsSinceLastRewardedImpression: lastReward
      ? Math.floor((Date.now() - lastReward.createdAt.getTime()) / 1000)
      : null,
    // The current request's own intent row is already stored, so a second row
    // with the same fingerprint is what indicates a repeat.
    duplicatePrompt: duplicateCount > 1,
    fraudScore: Number(user?.fraudScore ?? 0),
    worldVerified: user?.worldVerified ?? false,
  };
}

/**
 * Sustained prompt velocity is the cheapest reliable signal of automation.
 * Raises the score gradually rather than banning, so a genuinely fast developer
 * is throttled on rewards rather than locked out of the product.
 */
export async function recomputeFraudScore(userId: string): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const recentRequests = await prisma.aiIntentRecord.count({
    where: { userId, createdAt: { gte: fiveMinutesAgo } },
  });

  const score = recentRequests <= 20 ? 0 : Math.min(1, (recentRequests - 20) / 40);

  await prisma.user.update({
    where: { id: userId },
    data: { fraudScore: score },
  });

  return score;
}
