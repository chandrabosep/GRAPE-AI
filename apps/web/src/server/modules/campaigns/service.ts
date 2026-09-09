import { prisma, type Campaign, type CampaignStatus, type Prisma } from '@aam/db';
import { AppError, onchainCriteriaSchema, type OnchainCriteria, type OnchainSignals } from '@aam/shared';
import { economics } from '../../config/index';
import type { CreateCampaignInput, CreativeInput, TargetingInput } from './schemas';

/**
 * Campaign lifecycle.
 *
 * A campaign is only spendable while `active`, and it becomes active by being
 * funded. The allocation split is snapshotted at that moment so that editing
 * platform economics later cannot retroactively change what an advertiser
 * agreed to or what a user already earned.
 */

export type CampaignWithDetail = Prisma.CampaignGetPayload<{
  include: { targeting: true; creatives: true };
}>;

async function assertOwnership(campaignId: string, advertiserId: string): Promise<Campaign> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  // Same response whether it does not exist or belongs to someone else.
  if (!campaign || campaign.advertiserId !== advertiserId) {
    throw new AppError('not_found', 'Campaign not found');
  }
  return campaign;
}

export async function createCampaign(
  advertiserId: string,
  input: CreateCampaignInput,
): Promise<CampaignWithDetail> {
  if (input.endsAt <= input.startsAt) {
    throw new AppError('validation_failed', 'Campaign must end after it starts');
  }
  if (input.bidMicro > input.budgetMicro) {
    throw new AppError('validation_failed', 'Bid cannot exceed the total budget');
  }

  return prisma.campaign.create({
    data: {
      advertiserId,
      name: input.name,
      status: 'draft',
      budgetMicro: input.budgetMicro,
      bidMicro: input.bidMicro,
      dailySpendCapMicro: input.dailySpendCapMicro ?? null,
      clickMultiplier: input.clickMultiplier,
      // Snapshot: a live campaign's economics must not move under it.
      allocation: economics().allocation,
      frequencyCap: input.frequencyCap,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      targeting: { create: {} },
    },
    include: { targeting: true, creatives: true },
  });
}

export async function listCampaigns(advertiserId: string): Promise<CampaignWithDetail[]> {
  return prisma.campaign.findMany({
    where: { advertiserId },
    include: { targeting: true, creatives: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCampaign(
  campaignId: string,
  advertiserId: string,
): Promise<CampaignWithDetail> {
  await assertOwnership(campaignId, advertiserId);
  return prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { targeting: true, creatives: true },
  });
}

export async function updateTargeting(
  campaignId: string,
  advertiserId: string,
  input: TargetingInput,
): Promise<CampaignWithDetail> {
  await assertOwnership(campaignId, advertiserId);

  await prisma.campaignTargeting.upsert({
    where: { campaignId },
    create: { campaignId, ...input, onchainCriteria: input.onchainCriteria },
    update: { ...input, onchainCriteria: input.onchainCriteria },
  });

  return getCampaign(campaignId, advertiserId);
}

export async function upsertCreative(
  campaignId: string,
  advertiserId: string,
  input: CreativeInput,
): Promise<CampaignWithDetail> {
  await assertOwnership(campaignId, advertiserId);

  const existing = await prisma.adCreative.findFirst({
    where: { campaignId },
    orderBy: { createdAt: 'asc' },
  });

  if (existing) {
    await prisma.adCreative.update({
      where: { id: existing.id },
      data: { ...input, imageUrl: input.imageUrl ?? null },
    });
  } else {
    await prisma.adCreative.create({
      data: { campaignId, ...input, imageUrl: input.imageUrl ?? null },
    });
  }

  return getCampaign(campaignId, advertiserId);
}

/** Legal status moves. Anything not listed is rejected rather than silently ignored. */
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['awaiting_funding', 'ended'],
  awaiting_funding: ['active', 'draft', 'ended'],
  active: ['paused', 'exhausted', 'ended'],
  paused: ['active', 'ended'],
  exhausted: ['active', 'ended'],
  ended: [],
};

export async function transition(
  campaignId: string,
  advertiserId: string,
  next: CampaignStatus,
): Promise<Campaign> {
  const campaign = await assertOwnership(campaignId, advertiserId);

  if (!ALLOWED_TRANSITIONS[campaign.status].includes(next)) {
    throw new AppError(
      'campaign_not_fundable',
      `A ${campaign.status} campaign cannot become ${next}`,
    );
  }

  if (next === 'active') {
    const readiness = await checkReadyToRun(campaignId);
    if (!readiness.ready) {
      throw new AppError('campaign_not_fundable', readiness.reason);
    }
  }

  return prisma.campaign.update({ where: { id: campaignId }, data: { status: next } });
}

export interface Readiness {
  ready: boolean;
  reason: string;
}

/** A campaign with no creative or no budget would win auctions and show nothing. */
export async function checkReadyToRun(campaignId: string): Promise<Readiness> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { creatives: { where: { status: 'active' } }, targeting: true },
  });

  if (!campaign) return { ready: false, reason: 'Campaign not found' };
  if (campaign.creatives.length === 0) {
    return { ready: false, reason: 'Add a creative before launching' };
  }
  if (!campaign.targeting) {
    return { ready: false, reason: 'Configure targeting before launching' };
  }
  if (campaign.budgetMicro - campaign.spentMicro < campaign.bidMicro) {
    return { ready: false, reason: 'Remaining budget is below one bid' };
  }
  if (campaign.endsAt <= new Date()) {
    return { ready: false, reason: 'Campaign end date is in the past' };
  }

  return { ready: true, reason: '' };
}

export interface AudienceEstimate {
  eligibleUsers: number;
  byPersona: Record<string, number>;
  byOnchainSignal: Record<string, number>;
  /** True when the audience is too small to report without identifying anyone. */
  suppressed: boolean;
}

/** Counts below this are not reported, so an estimate cannot single anyone out. */
const MIN_REPORTABLE_AUDIENCE = 5;

/**
 * Estimated reach for a targeting configuration.
 *
 * Deliberately coarse and floored: this is the one advertiser-facing surface
 * that touches user data, so it returns counts over cached signals and never
 * anything that could identify a person.
 */
export async function estimateAudience(targeting: TargetingInput): Promise<AudienceEstimate> {
  const users = await prisma.user.findMany({
    where: {
      ...(targeting.countries.length > 0 ? { countryCode: { in: targeting.countries } } : {}),
      profile: {
        adsOptOut: false,
        ...(targeting.personas.length > 0 ? { persona: { in: targeting.personas } } : {}),
      },
    },
    select: {
      id: true,
      profile: { select: { persona: true, interests: true, technologies: true } },
      onchainSignals: { select: { signals: true }, take: 1 },
    },
    take: 5_000,
  });

  const criteria: OnchainCriteria = onchainCriteriaSchema.parse(targeting.onchainCriteria ?? {});
  const byPersona: Record<string, number> = {};
  const byOnchainSignal: Record<string, number> = {};
  let eligible = 0;

  for (const user of users) {
    const signals = (user.onchainSignals[0]?.signals ?? null) as OnchainSignals | null;

    if (targeting.onchainMode === 'require') {
      if (!signals) continue;
      if (criteria.requireWalletActivity && !signals.walletActivity) continue;
      if (criteria.protocolTypes.some((t) => !signals.protocolTypes.includes(t))) continue;
      if (
        criteria.protocols.length > 0 &&
        !criteria.protocols.some((p) => signals.protocols.includes(p))
      ) {
        continue;
      }
    }

    eligible += 1;

    const persona = user.profile?.persona;
    if (persona) byPersona[persona] = (byPersona[persona] ?? 0) + 1;

    if (signals) {
      for (const type of signals.protocolTypes) {
        byOnchainSignal[type] = (byOnchainSignal[type] ?? 0) + 1;
      }
    }
  }

  if (eligible < MIN_REPORTABLE_AUDIENCE) {
    return { eligibleUsers: eligible, byPersona: {}, byOnchainSignal: {}, suppressed: true };
  }

  return { eligibleUsers: eligible, byPersona, byOnchainSignal, suppressed: false };
}
