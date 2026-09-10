'use client';

import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/app/stat-card';
import { api, formatCredits } from '@/lib/api';

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
    headline: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
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
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-muted-foreground mx-auto max-w-5xl px-6 py-24 text-center text-sm">
        Campaign not found.
      </div>
    );
  }

  const budget = Number(campaign.budgetMicro);
  const spent = Number(campaign.spentMicro);
  const spendPct = budget > 0 ? (spent / budget) * 100 : 0;
  const targeting = campaign.targeting;
  const creative = campaign.creatives[0];

  const rewardShare = spent * campaign.allocation.reward;
  const platformShare = spent * campaign.allocation.platform;
  const treasuryShare = spent * campaign.allocation.treasury;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <Badge variant={campaign.status === 'active' ? 'default' : 'outline'}>
              {campaign.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatCredits(campaign.bidMicro)} per qualified impression ·{' '}
            {Number(campaign.clickMultiplier)}× on a click
          </p>
        </div>

        <div className="flex gap-2">
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

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Budget" value={formatCredits(budget, 2)} />
        <StatCard label="Spent" value={formatCredits(spent, 2)} />
        <StatCard label="Remaining" value={formatCredits(budget - spent, 2)} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Where your spend went</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={spendPct} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCredits(rewardShare)}
              </div>
              <div className="text-muted-foreground text-xs">
                to developers ({(campaign.allocation.reward * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCredits(platformShare)}
              </div>
              <div className="text-muted-foreground text-xs">
                platform ({(campaign.allocation.platform * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCredits(treasuryShare)}
              </div>
              <div className="text-muted-foreground text-xs">
                treasury ({(campaign.allocation.treasury * 100).toFixed(0)}%)
              </div>
            </div>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This split was snapshotted when the campaign was created, so later changes to platform
            economics cannot rewrite it.
          </p>
        </CardContent>
      </Card>

      {creative && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Creative</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Rendered exactly as a developer sees it, separator and label included. */}
            <div className="border-primary/60 bg-muted/40 max-w-md space-y-2 rounded-md border border-l-[3px] p-4">
              <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
                Sponsored · relevant to your task
              </div>
              <div className="font-medium">{creative.headline}</div>
              <div className="text-muted-foreground text-sm leading-relaxed">{creative.body}</div>
              <div className="text-primary text-sm">{creative.ctaText} →</div>
            </div>
          </CardContent>
        </Card>
      )}

      {targeting && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Targeting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <TargetRow label="AI intent" values={targeting.aiIntents} />
            <TargetRow label="Technologies" values={targeting.technologies} />
            <TargetRow label="Personas" values={targeting.personas} />
            <TargetRow label="Interests" values={targeting.interests} />
            <TargetRow label="Countries" values={targeting.countries} />

            <div>
              <div className="text-muted-foreground mb-1.5 text-xs tracking-wide uppercase">
                Onchain history
              </div>
              {targeting.onchainMode === 'off' ? (
                <span className="text-muted-foreground">Not used</span>
              ) : (
                <div className="space-y-1">
                  <Badge variant={targeting.onchainMode === 'require' ? 'default' : 'secondary'}>
                    {targeting.onchainMode}
                  </Badge>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Derived from The Graph. In <code>require</code> mode a developer with no linked
                    wallet is ineligible, which is why turning this on visibly changes which ad
                    wins.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TargetRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-xs tracking-wide uppercase">{label}</div>
      {values.length === 0 ? (
        <span className="text-muted-foreground">Anyone</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="text-[11px]">
              {value.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
