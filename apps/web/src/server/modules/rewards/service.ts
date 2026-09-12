import { prisma } from '@aam/db';
import {
  allocateCharge,
  applyTier,
  clickCharge,
  evaluateImpressionReward,
  impressionCharge,
} from '@aam/economics';
import { AppError, allocationSchema } from '@aam/shared';
import { economics } from '../../config/index';
import { logger } from '../../lib/logger';
import { creditReward } from '../credits/service';
import { collectAbuseSignals } from '../fraud/service';
import { getTierStanding } from '../tiers/service';

/**
 * Turning confirmed attention into credits.
 *
 * This is where the loop closes: an advertiser's budget becomes a developer's
 * ability to run another request. Three invariants make it safe to run on every
 * impression — a user can never be paid more than the advertiser was charged,
 * the reward is derived from the campaign's snapshotted allocation rather than
 * from whatever the config happens to say today, and the earning tier only ever
 * moves the *division* of that allocation, never its total.
 */

/**
 * What the advertiser was charged for one impression.
 *
 * `chargedMicro` is written at serve time, so it survives both a later change
 * to the format multipliers and a later edit to the campaign's bid. It is zero
 * only on rows written before that column existed, where the campaign bid is
 * the correct historical answer.
 */
function reservedMicro(impression: {
  chargedMicro: bigint;
  campaign: { bidMicro: bigint };
}): bigint {
  return impression.chargedMicro > 0n ? impression.chargedMicro : impression.campaign.bidMicro;
}

export interface RewardOutcome {
  granted: boolean;
  reason?: string;
  amountMicro: bigint;
  balanceMicro: bigint | null;
}

const NO_REWARD = (reason: string): RewardOutcome => ({
  granted: false,
  reason,
  amountMicro: 0n,
  balanceMicro: null,
});

/**
 * Marks an impression as actually seen and pays for it.
 *
 * Called when the client confirms the card was on screen for the dwell time.
 * Idempotent: a repeated ack returns the original outcome rather than paying
 * twice, which matters because clients retry.
 */
export async function confirmImpression(
  userId: string,
  impressionId: string,
  visibleMs: number,
): Promise<RewardOutcome> {
  const config = economics();

  const impression = await prisma.adImpression.findUnique({
    where: { id: impressionId },
    include: {
      campaign: { select: { id: true, allocation: true, bidMicro: true } },
      rewards: { select: { id: true, amountMicro: true } },
    },
  });

  if (!impression) throw new AppError('not_found', 'Impression not found');
  if (impression.userId !== userId) {
    // Do not reveal that someone else's impression exists.
    throw new AppError('not_found', 'Impression not found');
  }

  if (impression.rewards.length > 0) {
    return { granted: false, reason: 'already_rewarded', amountMicro: 0n, balanceMicro: null };
  }

  // Attention is confirmed once, and `viewedAt` is set on every outcome —
  // qualified or disqualified — so this is the record of a decision having been
  // made.
  //
  // Without it, an impression that was correctly refused at the time is still
  // open for re-evaluation later. Reopening an old conversation remounts its ad
  // card and the client acknowledges it again, and by then the gates that
  // refused it no longer apply: the daily cap has reset, the 60-second spacing
  // has long passed, the duplicate-prompt window has expired. The refusal would
  // quietly turn into a payment, repeatable by reopening the conversation. The
  // advertiser was charged once, so the decision is made once too.
  if (impression.viewedAt !== null) {
    return NO_REWARD(impression.disqualifyReason ?? 'already_evaluated');
  }

  // Below the dwell threshold the card was not meaningfully seen.
  const MIN_VISIBLE_MS = 1000;
  if (visibleMs < MIN_VISIBLE_MS) {
    await markDisqualified(impressionId, 'insufficient_dwell');
    return NO_REWARD('insufficient_dwell');
  }

  const intentRecord = impression.intentId
    ? await prisma.aiIntentRecord.findUnique({
        where: { id: impression.intentId },
        select: { promptHash: true },
      })
    : null;

  // The other slot of this same answer must not count against this one.
  const [signals, standing] = await Promise.all([
    collectAbuseSignals(userId, intentRecord?.promptHash ?? null, impression.requestId),
    getTierStanding(userId),
  ]);

  // What this slot actually reserved, not the campaign's headline bid. The two
  // differ whenever the format carries a multiplier, and paying out of the
  // headline bid would hand the user more than the advertiser was charged.
  const charge = impressionCharge(reservedMicro(impression));

  // The campaign's snapshotted split, re-divided for where this developer
  // stands. The tier is resolved from rewards granted *before* this one, so the
  // impression that lifts someone onto a new rung is paid at the old rate and
  // every impression after it at the new one — the ladder never reprices a
  // charge that has already been reserved.
  const allocation = applyTier(
    allocationSchema.parse(impression.campaign.allocation),
    standing.tier,
  );
  const split = allocateCharge(charge, allocation);

  const decision = evaluateImpressionReward(
    {
      viewConfirmed: true,
      alreadyRewarded: false,
      duplicatePrompt: signals.duplicatePrompt,
      secondsSinceLastRewardedImpression: signals.secondsSinceLastRewardedImpression,
      rewardedTodayMicro: signals.rewardedTodayMicro,
      worldVerified: signals.worldVerified,
      fraudScore: signals.fraudScore,
      tier: standing.tier,
    },
    split.rewardMicro,
    config,
  );

  // The impression still counts as delivered even when it earns nothing: the
  // advertiser was shown to a real person, the user simply is not paid again.
  await prisma.adImpression.update({
    where: { id: impressionId },
    data: {
      qualified: true,
      viewedAt: new Date(),
      disqualifyReason: decision.ok ? null : (decision.reason ?? null),
    },
  });

  await prisma.adEngagement.create({
    data: { impressionId, type: 'view_confirmed', metadata: { visibleMs } },
  });

  if (!decision.ok) return NO_REWARD(decision.reason ?? 'not_qualified');

  const amount = decision.cappedAtMicro ?? split.rewardMicro;
  if (amount <= 0n) return NO_REWARD('zero_reward');

  return grantReward({
    userId,
    impressionId,
    engagementId: null,
    campaignId: impression.campaign.id,
    kind: 'impression',
    chargeMicro: charge,
    amountMicro: amount,
    platformMicro: split.platformMicro,
    treasuryMicro: split.treasuryMicro,
  });
}

/**
 * Pays for a click on an already-confirmed impression.
 *
 * A click on an ad that was never confirmed visible is ignored entirely, which
 * removes the obvious way to farm the higher click reward.
 */
export async function recordClick(userId: string, impressionId: string): Promise<RewardOutcome> {
  const config = economics();

  const impression = await prisma.adImpression.findUnique({
    where: { id: impressionId },
    include: {
      campaign: {
        select: { id: true, allocation: true, bidMicro: true, clickMultiplier: true, budgetMicro: true, spentMicro: true },
      },
      engagements: { where: { type: { in: ['view_confirmed', 'click'] } }, select: { type: true } },
    },
  });

  if (!impression || impression.userId !== userId) {
    throw new AppError('not_found', 'Impression not found');
  }

  const engagement = await prisma.adEngagement.create({
    data: { impressionId, type: 'click', metadata: {} },
  });

  const viewed = impression.engagements.some((e) => e.type === 'view_confirmed');
  if (!viewed) return NO_REWARD('click_without_view');
  if (impression.engagements.some((e) => e.type === 'click')) {
    return NO_REWARD('already_clicked');
  }

  const charge = clickCharge(
    reservedMicro(impression),
    Number(impression.campaign.clickMultiplier),
  );

  // A click costs more than an impression, so the budget has to be checked again.
  const reserved = await prisma.$executeRaw`
    UPDATE campaigns
       SET spent_micro = spent_micro + ${charge}
     WHERE id = ${impression.campaign.id}
       AND budget_micro - spent_micro >= ${charge}
  `;
  if (reserved !== 1) return NO_REWARD('campaign_budget_exhausted');

  const [signals, standing] = await Promise.all([
    collectAbuseSignals(userId, null),
    getTierStanding(userId),
  ]);

  const allocation = applyTier(
    allocationSchema.parse(impression.campaign.allocation),
    standing.tier,
  );
  const split = allocateCharge(charge, allocation);

  const decision = evaluateImpressionReward(
    {
      viewConfirmed: true,
      alreadyRewarded: false,
      duplicatePrompt: false,
      // Clicks are a separate, rarer event, so the impression spacing rule does
      // not apply to them.
      secondsSinceLastRewardedImpression: null,
      rewardedTodayMicro: signals.rewardedTodayMicro,
      worldVerified: signals.worldVerified,
      fraudScore: signals.fraudScore,
      tier: standing.tier,
    },
    split.rewardMicro,
    config,
  );

  if (!decision.ok) return NO_REWARD(decision.reason ?? 'not_qualified');

  const amount = decision.cappedAtMicro ?? split.rewardMicro;
  if (amount <= 0n) return NO_REWARD('zero_reward');

  return grantReward({
    userId,
    impressionId,
    engagementId: engagement.id,
    campaignId: impression.campaign.id,
    kind: 'engagement',
    chargeMicro: charge,
    amountMicro: amount,
    platformMicro: split.platformMicro,
    treasuryMicro: split.treasuryMicro,
  });
}

interface GrantInput {
  userId: string;
  impressionId: string;
  engagementId: string | null;
  campaignId: string;
  kind: 'impression' | 'engagement';
  chargeMicro: bigint;
  amountMicro: bigint;
  platformMicro: bigint;
  treasuryMicro: bigint;
}

/** Writes the reward row, then credits the ledger. Both idempotent on the reward id. */
async function grantReward(input: GrantInput): Promise<RewardOutcome> {
  const reward = await prisma.reward.create({
    data: {
      userId: input.userId,
      impressionId: input.impressionId,
      engagementId: input.engagementId,
      campaignId: input.campaignId,
      kind: input.kind,
      chargeMicro: input.chargeMicro,
      amountMicro: input.amountMicro,
      platformMicro: input.platformMicro,
      treasuryMicro: input.treasuryMicro,
    },
    select: { id: true },
  });

  try {
    const ledger = await creditReward(input.userId, input.amountMicro, reward.id);

    await prisma.reward.update({
      where: { id: reward.id },
      data: { creditTxId: ledger.transaction.id },
    });

    return { granted: true, amountMicro: input.amountMicro, balanceMicro: ledger.balanceMicro };
  } catch (error) {
    // The reward is recorded but uncredited; reverse it rather than leaving the
    // ledger and the reward table disagreeing about what the user is owed.
    logger.error({ err: error, rewardId: reward.id }, 'failed to credit reward, reversing');
    await prisma.reward.update({ where: { id: reward.id }, data: { status: 'reversed' } });
    return NO_REWARD('credit_failed');
  }
}

async function markDisqualified(impressionId: string, reason: string): Promise<void> {
  await prisma.adImpression.update({
    where: { id: impressionId },
    data: { qualified: false, disqualifyReason: reason, viewedAt: new Date() },
  });
}

export async function recordDismiss(userId: string, impressionId: string): Promise<void> {
  const impression = await prisma.adImpression.findUnique({
    where: { id: impressionId },
    select: { userId: true },
  });
  if (!impression || impression.userId !== userId) return;

  await prisma.adEngagement.create({
    data: { impressionId, type: 'dismiss', metadata: {} },
  });
}

/** The categorical explanation shown behind "Why this ad?". Never prompt text. */
export async function explainImpression(userId: string, impressionId: string): Promise<string[]> {
  const impression = await prisma.adImpression.findUnique({
    where: { id: impressionId },
    select: { userId: true, signalsUsed: true },
  });

  if (!impression || impression.userId !== userId) {
    throw new AppError('not_found', 'Impression not found');
  }

  await prisma.adEngagement.create({
    data: { impressionId, type: 'why_opened', metadata: {} },
  });

  return Array.isArray(impression.signalsUsed) ? (impression.signalsUsed as string[]) : [];
}
