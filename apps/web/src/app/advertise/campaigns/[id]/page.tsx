'use client';

import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Metric, MetricGrid } from '@/components/app/metric';
import { Eyebrow, Shell, Stamp } from '@/components/app/section';
import { InlineSponsoredPreview, SponsoredPreview } from '@/components/app/sponsored-preview';
import { InsightsCharts, type CampaignInsights } from '@/components/app/insights-charts';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/credits';

interface Campaign {
  id: string;
  name: string;
  status: string;
  budgetMicro: string;
  spentMicro: string;
  bidMicro: string;
  clickMultiplier: string;
  allocation: { reward: number; platform: number; treasury: number };
  startsAt: string;
  endsAt: string;
  targeting: {
    countries: string[];
    personas: string[];
    interests: string[];
    technologies: string[];
    intentCategories: string[];
    aiIntents: string[];
    minCommercialIntent: string;
    onchainMode: string;
    onchainCriteria: Record<string, unknown>;
  } | null;
  creatives: {
    id: string;
    format: 'banner' | 'inline';
    headline: string;
    body: string | null;
    ctaText: string;
    ctaUrl: string;
    imageUrl: string | null;
  }[];
}

const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  draft: [{ label: 'Submit for funding', status: 'awaiting_funding' }],
  awaiting_funding: [{ label: 'Launch', status: 'active' }],
  active: [{ label: 'Pause', status: 'paused' }],
  paused: [{ label: 'Resume', status: 'active' }],
};

export default function CampaignDetail({ params }: PageProps<'/advertise/campaigns/[id]'>) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ['campaign', id],
    queryFn: () => api<Campaign>(`/campaigns/${id}`),
  });

  // Only for the creative preview: the card carries the advertiser's name, so
  // the preview has to as well or it is not the card the developer sees.
  const { data: advertiser } = useQuery<{ name: string }>({
    queryKey: ['advertiser', 'me'],
    queryFn: () => api<{ name: string }>('/advertisers/me'),
  });

  const { data: insights } = useQuery<CampaignInsights>({
    queryKey: ['campaign-insights', id],
    queryFn: () => api<CampaignInsights>(`/advertisers/me/insights?campaignId=${id}&days=30`),
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      api(`/campaigns/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: async () => {
      toast.success('Campaign updated');
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <Shell className="max-w-5xl space-y-8 py-16">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-36 w-full" />
      </Shell>
    );
  }

  if (!campaign) {
    return (
      <Shell className="py-28">
        <Eyebrow>Not found</Eyebrow>
        <h1 className="display-serif text-almost-white mt-8 text-[clamp(2rem,5vw,3.5rem)]">
          That campaign is not here
        </h1>
        <Button
          variant="outline"
          className="mt-10"
          nativeButton={false}
          render={<Link href="/advertise" />}
        >
          Back to campaigns
        </Button>
      </Shell>
    );
  }

  const budget = Number(campaign.budgetMicro);
  const spent = Number(campaign.spentMicro);
  const spendPct = budget > 0 ? (spent / budget) * 100 : 0;
  const targeting = campaign.targeting;
  const banner = campaign.creatives.find((c) => c.format === 'banner');
  const inline = campaign.creatives.find((c) => c.format === 'inline');
  const live = campaign.status === 'active';

  /*
   * The floor of the split, not the settled one.
   *
   * A developer on a higher earning tier is paid a larger share of the same
   * charge, and the difference comes out of the platform's cut rather than off
   * this campaign's bill. So the developer line is a lower bound and the
   * platform line an upper one, while `spent` — the only figure the advertiser
   * is actually out — is exact either way.
   */
  const rewardShare = spent * campaign.allocation.reward;
  const platformShare = spent * campaign.allocation.platform;
  const treasuryShare = spent * campaign.allocation.treasury;

  return (
    <Shell className="max-w-5xl py-16 md:py-20">
      <Link
        href="/advertise"
        className="text-steel hover:text-almost-white stamp-sm inline-block transition-colors"
      >
        ← All campaigns
      </Link>

      <div className="mt-8 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-almost-white text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-light tracking-[-0.03em]">
              {campaign.name}
            </h1>
            <Badge variant={live ? 'live' : 'outline'}>
              {live && <span className="bg-signal-violet size-1.5 shrink-0 rounded-full" />}
              {campaign.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="text-steel mt-3 text-sm tabular-nums">
            {formatUsd(campaign.bidMicro)} per qualified impression ·{' '}
            {Number(campaign.clickMultiplier)}× on a click
          </p>
          {/* The auction only ever considers active campaigns, so a draft that
              looks finished is the easiest way to conclude the ads are broken. */}
          {!live && (
            <p className="text-graphite mt-2 max-w-xl text-sm leading-relaxed">
              {campaign.status === 'draft' || campaign.status === 'awaiting_funding'
                ? 'Not in the auction yet — only active campaigns are eligible to be served.'
                : `A ${campaign.status.replace(/_/g, ' ')} campaign is not served.`}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          {(NEXT_STATUS[campaign.status] ?? []).map((action) => (
            <Button
              key={action.status}
              variant={action.status === 'active' ? 'default' : 'outline'}
              onClick={() => transition.mutate(action.status)}
              disabled={transition.isPending}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <MetricGrid columns={3} className="mt-12">
        <Metric label="Budget" value={formatUsd(budget, 2)} />
        <Metric label="Spent" value={formatUsd(spent, 2)} />
        <Metric label="Remaining" value={formatUsd(budget - spent, 2)} />
      </MetricGrid>

      <section className="mt-20">
        <Stamp
          size="section"
          sub="This split was snapshotted when the campaign was created, so later changes to platform economics cannot rewrite it."
        >
          Where your spend went
        </Stamp>

        <div className="border-hairline mt-10 border-t pt-8">
          <Progress value={spendPct} />
        </div>

        <MetricGrid columns={3} className="mt-8">
          <Metric
            label="To developers"
            value={`${formatUsd(rewardShare)}+`}
            hint={`At least ${(campaign.allocation.reward * 100).toFixed(0)}% of what you were charged. Developers on a higher tier earn more, out of our share and not your budget.`}
            accent
          />
          <Metric
            label="Platform"
            value={formatUsd(platformShare)}
            hint={`${(campaign.allocation.platform * 100).toFixed(0)}%, less whatever tiers moved to developers`}
          />
          <Metric
            label="Treasury"
            value={formatUsd(treasuryShare)}
            hint={`${(campaign.allocation.treasury * 100).toFixed(0)}%`}
          />
        </MetricGrid>
      </section>

      <section className="mt-24">
        <Stamp
          size="section"
          sub="A campaign can run either format or both. Each is its own auction and its own charge — the inline line bills at a fraction of your bid, because it is a fraction of the attention."
        >
          Creatives
        </Stamp>

        <div className="border-hairline mt-10 grid gap-12 border-t pt-10 md:grid-cols-2">
          <div className="space-y-4">
            <div className="stamp-sm">Banner — after the answer</div>
            {banner ? (
              /* Rendered exactly as a developer sees it, separator and badge included. */
              <SponsoredPreview
                headline={banner.headline}
                body={banner.body ?? ''}
                ctaText={banner.ctaText}
                imageUrl={banner.imageUrl}
                advertiserName={advertiser?.name ?? 'Advertiser'}
              />
            ) : (
              <p className="text-steel text-sm leading-relaxed">
                No banner creative. This campaign will not compete for the card slot.
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="stamp-sm">Inline — while the answer streams</div>
            {inline ? (
              <InlineSponsoredPreview
                headline={inline.headline}
                ctaText={inline.ctaText}
                advertiserName={advertiser?.name ?? 'Advertiser'}
              />
            ) : (
              <p className="text-steel text-sm leading-relaxed">
                No inline creative. This campaign will not compete for the inline slot.
              </p>
            )}
          </div>
        </div>
      </section>

      {insights && (
        <section className="mt-24">
          <Stamp size="section" sub="Last 30 days.">
            Performance
          </Stamp>

          {/* The funnel first — impressions, then clicks, then the two rates
              derived from them — so a rate always has its counts beside it. */}
          <MetricGrid columns={3} className="mt-10">
            <Metric
              label="Impressions"
              value={insights.totals.impressions.toLocaleString()}
              hint={`${insights.totals.qualified.toLocaleString()} qualified · ${(
                insights.totals.viewRate * 100
              ).toFixed(1)}% actually looked at`}
            />
            <Metric
              label="Clicks"
              value={insights.totals.clicks.toLocaleString()}
              hint="Taps through to your link"
            />
            <Metric
              label="Click-through rate"
              value={`${(insights.totals.clickThroughRate * 100).toFixed(1)}%`}
              hint="Clicks per qualified impression"
            />
            <Metric
              label="Cost per click"
              value={
                insights.totals.costPerClickMicro
                  ? formatUsd(insights.totals.costPerClickMicro, 4)
                  : '—'
              }
              hint={
                insights.totals.costPerMilleMicro
                  ? `${formatUsd(insights.totals.costPerMilleMicro, 2)} per 1,000 qualified`
                  : 'No clicks in this window yet'
              }
            />
            <Metric
              label="Spend in window"
              value={formatUsd(insights.totals.spendMicro, 2)}
              hint={`${formatUsd(insights.totals.rewardMicro, 2)} reached developers`}
            />
            <Metric
              label="Average relevance"
              value={insights.totals.averageRelevance.toFixed(3)}
              hint="Auction score of your winning impressions"
            />
          </MetricGrid>

          <div className="mt-8">
            <InsightsCharts data={insights} />
          </div>
        </section>
      )}

      {targeting && (
        <section className="mt-24">
          <Stamp size="section">Targeting</Stamp>

          <dl className="border-hairline mt-10 border-t">
            <TargetRow label="AI intent" values={targeting.aiIntents} />
            <TargetRow label="Technologies" values={targeting.technologies} />
            <TargetRow label="Personas" values={targeting.personas} />
            <TargetRow label="Interests" values={targeting.interests} />
            <TargetRow label="Countries" values={targeting.countries} />

            <div className="border-hairline grid gap-4 border-b py-6 md:grid-cols-[200px_1fr] md:gap-10">
              <dt className="stamp-sm md:pt-1">Onchain history</dt>
              <dd className="min-w-0">
                {targeting.onchainMode === 'off' ? (
                  <span className="text-graphite text-sm">Not used</span>
                ) : (
                  <div className="space-y-3">
                    <Badge variant={targeting.onchainMode === 'require' ? 'live' : 'default'}>
                      {targeting.onchainMode}
                    </Badge>
                    <p className="text-steel max-w-xl text-xs leading-relaxed">
                      Derived from The Graph. In <code className="font-mono">require</code> mode a
                      developer with no linked wallet is ineligible, which is why turning this on
                      visibly changes which ad wins.
                    </p>
                  </div>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </Shell>
  );
}

/**
 * One targeting dimension.
 *
 * A definition row rather than a stacked block: the label column is fixed, so
 * five dimensions read straight down as a table of what this campaign will and
 * will not match.
 */
function TargetRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="border-hairline grid gap-4 border-b py-6 md:grid-cols-[200px_1fr] md:gap-10">
      <dt className="stamp-sm md:pt-1">{label}</dt>
      <dd className="min-w-0">
        {values.length === 0 ? (
          <span className="text-graphite text-sm">Anyone</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {values.map((value) => (
              <Badge key={value} variant="secondary">
                {value.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}
      </dd>
    </div>
  );
}
