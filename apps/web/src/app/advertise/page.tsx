'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/app/stat-card';
import {
  InsightsCharts,
  type CampaignInsights,
} from '@/components/app/insights-charts';
import { api, formatCredits } from '@/lib/api';
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
  rewardPaidMicro: string;
  averageRelevance: number;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  budgetMicro: string;
  spentMicro: string;
  bidMicro: string;
  targeting: {
    aiIntents: string[];
    technologies: string[];
    onchainMode: string;
  } | null;
  creatives: { headline: string }[];
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  draft: 'outline',
  awaiting_funding: 'secondary',
  paused: 'secondary',
  exhausted: 'destructive',
  ended: 'outline',
};

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
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to manage campaigns</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-relaxed">
          Connect your wallet from the header to create and manage campaigns.
        </p>
      </div>
    );
  }

  if (!isAdvertiser) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reach developers as they build</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-sm leading-relaxed">
          Target derived intent and real onchain history rather than demographics. You will never
          receive a prompt, a wallet address or an individual user.
        </p>
        <Button className="mt-6" onClick={() => become.mutate()} disabled={become.isPending}>
          {become.isPending ? 'Creating…' : 'Create advertiser profile'}
        </Button>
      </div>
    );
  }

  const spendPct =
    overview && Number(overview.budgetMicro) > 0
      ? (Number(overview.spentMicro) / Number(overview.budgetMicro)) * 100
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            You are charged for confirmed attention, not for an ad being selected.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/advertise/campaigns/new" />}>New campaign</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Spent"
          value={formatCredits(overview?.spentMicro, 2)}
          hint={`of ${formatCredits(overview?.budgetMicro, 2)} funded`}
        />
        <StatCard
          label="Qualified impressions"
          value={(overview?.qualifiedImpressions ?? 0).toLocaleString()}
          hint={`${overview?.impressions ?? 0} selected, ${overview?.clicks ?? 0} clicked`}
        />
        <StatCard
          label="Average relevance"
          value={(overview?.averageRelevance ?? 0).toFixed(3)}
          hint="Auction score of your winning impressions"
        />
        <StatCard
          label="Paid to developers"
          value={formatCredits(overview?.rewardPaidMicro)}
          hint="70% of what you were charged"
          accent
        />
      </div>

      {overview && Number(overview.budgetMicro) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Budget used</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={spendPct} />
            <p className="text-muted-foreground mt-2 text-xs tabular-nums">
              {spendPct.toFixed(1)}% · {formatCredits(overview.spentMicro, 2)} of{' '}
              {formatCredits(overview.budgetMicro, 2)}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Performance. The stat row answers "is this working"; the charts answer
          "what changed". Both read from the same windowed query. */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Performance</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Across every campaign you run.
            </p>
          </div>

          {/* Filters in one row above the charts, never beside them. */}
          <div className="flex items-center gap-1 rounded-lg border p-1">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  days === range.days
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Click-through rate"
            value={
              insights ? `${(insights.totals.clickThroughRate * 100).toFixed(1)}%` : '—'
            }
            hint={`${(insights?.totals.clicks ?? 0).toLocaleString()} clicks on ${(
              insights?.totals.qualified ?? 0
            ).toLocaleString()} qualified`}
          />
          <StatCard
            label="View rate"
            value={insights ? `${(insights.totals.viewRate * 100).toFixed(1)}%` : '—'}
            hint="Selected impressions a developer actually looked at"
          />
          <StatCard
            label="Cost per click"
            value={
              insights?.totals.costPerClickMicro
                ? formatCredits(insights.totals.costPerClickMicro, 4)
                : '—'
            }
            hint={
              insights?.totals.costPerMilleMicro
                ? `${formatCredits(insights.totals.costPerMilleMicro, 2)} per 1,000 qualified`
                : 'No clicks in this window yet'
            }
          />
          <StatCard
            label="Spend in window"
            value={formatCredits(insights?.totals.spendMicro, 2)}
            hint={`${formatCredits(insights?.totals.rewardMicro, 2)} reached developers`}
            accent
          />
        </div>

        {insights ? (
          <InsightsCharts data={insights} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        )}
      </section>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">All campaigns</h2>
        {(campaigns ?? []).map((campaign) => {
          const remaining = Number(campaign.budgetMicro) - Number(campaign.spentMicro);
          return (
            <Link key={campaign.id} href={`/advertise/campaigns/${campaign.id}`} className="block">
              <Card className="hover:border-foreground/20 transition-colors">
                <CardContent className="flex flex-wrap items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{campaign.name}</span>
                      <Badge variant={STATUS_VARIANT[campaign.status] ?? 'outline'}>
                        {campaign.status.replace(/_/g, ' ')}
                      </Badge>
                      {campaign.targeting?.onchainMode !== 'off' && (
                        <Badge variant="outline">onchain {campaign.targeting?.onchainMode}</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-sm">
                      {campaign.creatives[0]?.headline ?? 'No creative yet'}
                    </p>
                    {campaign.status !== 'active' && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                        Not serving — open it to launch.
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(campaign.targeting?.aiIntents ?? []).slice(0, 3).map((intent) => (
                        <Badge key={intent} variant="secondary" className="text-[10px]">
                          {intent.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="text-right text-sm tabular-nums">
                    <div>{formatCredits(remaining, 2)} left</div>
                    <div className="text-muted-foreground text-xs">
                      {formatCredits(campaign.bidMicro)} per impression
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {campaigns?.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground py-12 text-center text-sm">
              No campaigns yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
