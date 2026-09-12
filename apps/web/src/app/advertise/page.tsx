'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Metric, MetricGrid } from '@/components/app/metric';
import { Eyebrow, Shell, Stamp } from '@/components/app/section';
import { InsightsCharts, type CampaignInsights } from '@/components/app/insights-charts';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/credits';
import { useMe } from '@/hooks/use-session';
import { toast } from 'sonner';

interface Overview {
  campaignCount: number;
  activeCampaigns: number;
  budgetMicro: string;
  spentMicro: string;
  impressions: number;
  qualifiedImpressions: number;
  clicks: number;
  viewRate: number;
  clickThroughRate: number;
  costPerClickMicro: string | null;
  costPerMilleMicro: string | null;
  rewardPaidMicro: string;
  averageRelevance: number;
}

/** Lifetime delivery for one campaign, as the list row shows it. */
interface CampaignMetrics {
  impressions: number;
  qualified: number;
  clicks: number;
  clickThroughRate: number;
  costPerClickMicro: string | null;
  costPerMilleMicro: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  budgetMicro: string;
  spentMicro: string;
  bidMicro: string;
  metrics: CampaignMetrics;
  targeting: {
    aiIntents: string[];
    technologies: string[];
    onchainMode: string;
  } | null;
  creatives: { headline: string }[];
}

/** Rates are read at a glance, so one decimal is all that helps. */
function percent(value: number | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

/** Windows the dashboard offers. Short enough to read, long enough to show a trend. */
const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

export default function AdvertiserDashboard() {
  const { data: me, isLoading: loadingMe } = useMe();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);

  const isAdvertiser = me?.user.roles.includes('advertiser') ?? false;

  const { data: overview } = useQuery<Overview>({
    queryKey: ['advertiser-overview'],
    queryFn: () => api<Overview>('/advertisers/me/overview'),
    enabled: isAdvertiser,
  });

  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => api<Campaign[]>('/campaigns'),
    enabled: isAdvertiser,
  });

  const { data: insights } = useQuery<CampaignInsights>({
    queryKey: ['advertiser-insights', days],
    queryFn: () => api<CampaignInsights>(`/advertisers/me/insights?days=${days}`),
    enabled: isAdvertiser,
  });

  const become = useMutation({
    mutationFn: () =>
      api('/advertisers', {
        method: 'POST',
        body: JSON.stringify({ companyName: `${me?.user.displayName ?? 'My'} Ads` }),
      }),
    onSuccess: async () => {
      toast.success('Advertiser profile created');
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (loadingMe) {
    return (
      <Shell className="space-y-8 py-16">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-36 w-full" />
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell className="py-28 md:py-36">
        <Eyebrow>Not signed in</Eyebrow>
        <h1 className="display-serif text-almost-white mt-8 max-w-2xl text-[clamp(2.25rem,6vw,4rem)] text-balance">
          Sign in to manage campaigns
        </h1>
        <p className="text-steel mt-7 max-w-xl text-[17px] leading-relaxed font-light">
          Connect your wallet from the header to create and manage campaigns.
        </p>
      </Shell>
    );
  }

  if (!isAdvertiser) {
    return (
      <Shell className="py-28 md:py-36">
        <Eyebrow>Become an advertiser</Eyebrow>
        <h1 className="mt-8 max-w-3xl text-balance">
          <span className="display-serif text-almost-white block text-[clamp(2.5rem,7vw,5rem)]">
            Reach developers
          </span>
          <span className="text-almost-white mt-2 block text-[clamp(1.75rem,4.5vw,3rem)] leading-tight font-light tracking-[-0.03em]">
            as they build
          </span>
        </h1>
        <p className="text-steel mt-8 max-w-xl text-[17px] leading-relaxed font-light text-pretty">
          Target derived intent and real onchain history rather than demographics. You will never
          receive a prompt, a wallet address or an individual user.
        </p>
        <Button
          size="lg"
          className="mt-10"
          onClick={() => become.mutate()}
          disabled={become.isPending}
        >
          {become.isPending ? 'Creating…' : 'Create advertiser profile'}
        </Button>
      </Shell>
    );
  }

  const spendPct =
    overview && Number(overview.budgetMicro) > 0
      ? (Number(overview.spentMicro) / Number(overview.budgetMicro)) * 100
      : 0;

  return (
    <Shell className="py-16 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Stamp as="h1" sub="You are charged for confirmed attention, not for an ad being selected.">
          Campaigns
        </Stamp>
        <Button nativeButton={false} render={<Link href="/advertise/campaigns/new" />}>
          New campaign
        </Button>
      </div>

      {/* All time. Read left to right it is the funnel itself: impressions
          served, of those the ones confirmed on screen, of those the ones
          clicked — then what that attention cost and where the money went. */}
      <section className="mt-20">
        <Stamp size="section" sub="Every campaign you have ever run.">
            All time
          </Stamp>

        <MetricGrid columns={3} className="mt-10">
          <Metric
            label="Impressions"
            value={(overview?.impressions ?? 0).toLocaleString()}
            hint={`${(overview?.qualifiedImpressions ?? 0).toLocaleString()} qualified · ${percent(
              overview?.viewRate,
            )} actually looked at`}
          />
          <Metric
            label="Clicks"
            value={(overview?.clicks ?? 0).toLocaleString()}
            hint="Taps through to your link"
          />
          <Metric
            label="Click-through rate"
            value={overview ? percent(overview.clickThroughRate) : '—'}
            hint="Clicks per qualified impression"
          />
          <Metric
            label="Cost per click"
            value={overview?.costPerClickMicro ? formatUsd(overview.costPerClickMicro, 4) : '—'}
            hint={
              overview?.costPerMilleMicro
                ? `${formatUsd(overview.costPerMilleMicro, 2)} per 1,000 qualified`
                : 'No clicks yet'
            }
          />
          <Metric
            label="Spent"
            value={formatUsd(overview?.spentMicro, 2)}
            hint={`of ${formatUsd(overview?.budgetMicro, 2)} funded`}
          />
          <Metric
            label="Paid to developers"
            value={formatUsd(overview?.rewardPaidMicro)}
            hint="At least 70% of what you were charged — more to developers on a higher tier, out of our cut"
            accent
          />
        </MetricGrid>

        {overview && Number(overview.budgetMicro) > 0 && (
          <div className="border-hairline mt-10 border-t pt-8">
            <Progress value={spendPct} />
            <p className="text-steel mt-3 text-xs tabular-nums">
              {spendPct.toFixed(1)}% of funded budget used · {formatUsd(overview.spentMicro, 2)}{' '}
              of {formatUsd(overview.budgetMicro, 2)}
            </p>
          </div>
        )}
      </section>

      {/* Performance. The stat row answers "is this working"; the charts answer
          "what changed". Both read from the same windowed query. */}
      <section className="mt-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Stamp size="section" sub="Across every campaign you run.">
            Performance
          </Stamp>

          {/* Filters in one row above the charts, never beside them. */}
          <div className="border-hairline flex items-center gap-1 rounded-[10.8px] border p-1">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                className={`rounded-control px-3.5 py-1.5 text-xs transition-colors ${
                  days === range.days
                    ? 'bg-wash-strong text-almost-white'
                    : 'text-steel hover:text-almost-white'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <MetricGrid className="mt-10">
          <Metric
            label="Impressions"
            value={(insights?.totals.impressions ?? 0).toLocaleString()}
            hint={`${(insights?.totals.qualified ?? 0).toLocaleString()} qualified · ${percent(
              insights?.totals.viewRate,
            )} view rate`}
          />
          <Metric
            label="Click-through rate"
            value={insights ? percent(insights.totals.clickThroughRate) : '—'}
            hint={`${(insights?.totals.clicks ?? 0).toLocaleString()} clicks on ${(
              insights?.totals.qualified ?? 0
            ).toLocaleString()} qualified`}
          />
          <Metric
            label="Cost per click"
            value={
              insights?.totals.costPerClickMicro
                ? formatUsd(insights.totals.costPerClickMicro, 4)
                : '—'
            }
            hint={
              insights?.totals.costPerMilleMicro
                ? `${formatUsd(insights.totals.costPerMilleMicro, 2)} per 1,000 qualified`
                : 'No clicks in this window yet'
            }
          />
          <Metric
            label="Spend in window"
            value={formatUsd(insights?.totals.spendMicro, 2)}
            hint={`${formatUsd(insights?.totals.rewardMicro, 2)} reached developers`}
            accent
          />
        </MetricGrid>

        <div className="mt-8">
          {insights ? (
            <InsightsCharts data={insights} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
          )}
        </div>
      </section>

      <section className="mt-24">
        <Stamp size="section">All campaigns</Stamp>

        <div className="border-hairline mt-10 border-t">
          {(campaigns ?? []).map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))}

          {campaigns?.length === 0 && (
            <p className="border-hairline text-steel border-b py-16 text-center text-sm">
              No campaigns yet.
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}

/**
 * One campaign, as a row rather than a card.
 *
 * Delivery lives on the row itself: which campaign is being seen and clicked is
 * the reason this list is opened, and it was previously only answerable one
 * campaign at a time.
 */
function CampaignRow({ campaign }: { campaign: Campaign }) {
  const remaining = Number(campaign.budgetMicro) - Number(campaign.spentMicro);
  const live = campaign.status === 'active';

  return (
    <Link
      href={`/advertise/campaigns/${campaign.id}`}
      className="border-hairline hover:bg-wash group flex flex-wrap items-start gap-x-10 gap-y-5 border-b px-1 py-7 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-almost-white truncate text-lg font-light tracking-[-0.01em]">
            {campaign.name}
          </span>
          {/* A live campaign is marked by a violet beacon. Every other status
              is achromatic, which is what keeps the beacon meaning anything. */}
          <Badge variant={live ? 'live' : 'outline'}>
            {live && <span className="bg-signal-violet size-1.5 shrink-0 rounded-full" />}
            {campaign.status.replace(/_/g, ' ')}
          </Badge>
          {campaign.targeting?.onchainMode !== 'off' && (
            <Badge variant="secondary">onchain {campaign.targeting?.onchainMode}</Badge>
          )}
        </div>

        <p className="text-steel mt-2 truncate text-sm">
          {campaign.creatives[0]?.headline ?? 'No creative yet'}
        </p>

        {!live && (
          <p className="text-graphite mt-2 text-xs">Not serving — open it to launch.</p>
        )}

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {(campaign.targeting?.aiIntents ?? []).slice(0, 3).map((intent) => (
            <Badge key={intent} variant="secondary">
              {intent.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      </div>

      {/* Two up on a phone, four across from `sm`. `shrink-0` here would keep
          the block at its full four-column intrinsic width and scroll the page
          sideways, so the row wraps instead. */}
      <div className="grid w-full grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-9 sm:gap-y-3">
        <RowMetric
          label="Impressions"
          value={campaign.metrics.impressions.toLocaleString()}
          hint={`${campaign.metrics.qualified.toLocaleString()} qualified`}
        />
        <RowMetric
          label="CTR"
          value={percent(campaign.metrics.clickThroughRate)}
          hint={`${campaign.metrics.clicks.toLocaleString()} click${
            campaign.metrics.clicks === 1 ? '' : 's'
          }`}
        />
        <RowMetric
          label="Cost per click"
          value={
            campaign.metrics.costPerClickMicro
              ? formatUsd(campaign.metrics.costPerClickMicro, 4)
              : '—'
          }
          hint={`${formatUsd(campaign.bidMicro)} bid`}
        />
        <RowMetric
          label="Remaining"
          value={formatUsd(remaining, 2)}
          hint={`${formatUsd(campaign.spentMicro, 2)} spent`}
        />
      </div>
    </Link>
  );
}

/** One number on a campaign row. Label above, so four of them read as a table. */
function RowMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="text-right sm:min-w-[88px]">
      <div className="stamp-sm text-right">{label}</div>
      <div className="text-almost-white mt-2 text-sm tabular-nums">{value}</div>
      {hint && <div className="text-graphite mt-1 text-[11px] tabular-nums">{hint}</div>}
    </div>
  );
}
