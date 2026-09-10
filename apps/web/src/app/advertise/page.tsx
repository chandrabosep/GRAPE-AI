'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/app/stat-card';
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

export default function AdvertiserDashboard() {
  const { data: me, isLoading: loadingMe } = useMe();
  const queryClient = useQueryClient();

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
          Use the sign-in menu in the header and pick one of the seeded advertiser accounts.
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
        <Button render={<Link href="/advertise/campaigns/new" />}>New campaign</Button>
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

      <div className="space-y-3">
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
