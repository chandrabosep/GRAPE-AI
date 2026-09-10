import { prisma, type Advertiser, transaction } from '@aam/db';
import { AppError } from '@aam/shared';
import { grantRole } from '../users/service';

/**
 * Advertiser onboarding.
 *
 * An advertiser is an organisation plus the user who acts for it. Keeping the
 * organisation separate is what later allows a shared treasury wallet and
 * multiple seats without reshaping anything.
 */

export interface CreateAdvertiserInput {
  userId: string;
  companyName: string;
  website?: string;
}

export async function createAdvertiser(input: CreateAdvertiserInput): Promise<Advertiser> {
  const existing = await prisma.advertiser.findFirst({
    where: { userId: input.userId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  const advertiser = await transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.companyName, ownerUserId: input.userId },
    });

    return tx.advertiser.create({
      data: {
        orgId: org.id,
        userId: input.userId,
        name: input.companyName,
        website: input.website ?? null,
      },
    });
  });

  await grantRole(input.userId, 'advertiser');
  return advertiser;
}

/** Resolves the advertiser acting for this user, or 403. */
export async function requireAdvertiser(userId: string): Promise<Advertiser> {
  const advertiser = await prisma.advertiser.findFirst({ where: { userId } });
  if (!advertiser) {
    throw new AppError('forbidden', 'Create an advertiser profile before managing campaigns');
  }
  if (advertiser.status === 'suspended') {
    throw new AppError('forbidden', 'This advertiser account is suspended');
  }
  return advertiser;
}

export interface AdvertiserOverview {
  campaignCount: number;
  activeCampaigns: number;
  budgetMicro: bigint;
  spentMicro: bigint;
  impressions: number;
  qualifiedImpressions: number;
  clicks: number;
  rewardPaidMicro: bigint;
  averageRelevance: number;
}

/**
 * Advertiser-facing totals.
 *
 * Everything here is an aggregate over the advertiser's own campaigns. There is
 * deliberately no query in this module that can return a per-user row, which is
 * what makes "advertisers never see individuals" a property of the code rather
 * than a policy.
 */
export async function advertiserOverview(advertiserId: string): Promise<AdvertiserOverview> {
  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId },
    select: { id: true, status: true, budgetMicro: true, spentMicro: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  if (campaignIds.length === 0) {
    return {
      campaignCount: 0,
      activeCampaigns: 0,
      budgetMicro: 0n,
      spentMicro: 0n,
      impressions: 0,
      qualifiedImpressions: 0,
      clicks: 0,
      rewardPaidMicro: 0n,
      averageRelevance: 0,
    };
  }

  const [impressions, qualified, clicks, rewards, relevance] = await Promise.all([
    prisma.adImpression.count({ where: { campaignId: { in: campaignIds } } }),
    prisma.adImpression.count({ where: { campaignId: { in: campaignIds }, qualified: true } }),
    prisma.adEngagement.count({
      where: { type: 'click', impression: { campaignId: { in: campaignIds } } },
    }),
    prisma.reward.aggregate({
      where: { campaignId: { in: campaignIds }, status: 'granted' },
      _sum: { amountMicro: true },
    }),
    prisma.adImpression.aggregate({
      where: { campaignId: { in: campaignIds } },
      _avg: { scoreTotal: true },
    }),
  ]);

  return {
    campaignCount: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
    budgetMicro: campaigns.reduce((sum, c) => sum + c.budgetMicro, 0n),
    spentMicro: campaigns.reduce((sum, c) => sum + c.spentMicro, 0n),
    impressions,
    qualifiedImpressions: qualified,
    clicks,
    rewardPaidMicro: rewards._sum.amountMicro ?? 0n,
    averageRelevance: Number(relevance._avg.scoreTotal ?? 0),
  };
}
