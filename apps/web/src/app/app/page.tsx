'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/app/stat-card';
import { api, formatCredits } from '@/lib/api';
import { useMe } from '@/hooks/use-session';

interface LedgerEntry {
  id: string;
  type: string;
  amountMicro: string;
  balanceAfterMicro: string;
  refType: string | null;
  createdAt: string;
}

interface Ledger {
  balanceMicro: string;
  withdrawableMicro: string;
  transactions: LedgerEntry[];
}

/** Plain-language reasons, so the ledger explains itself. */
const TYPE_LABEL: Record<string, string> = {
  reward_earned: 'Earned from sponsored content',
  inference_spent: 'AI request',
  purchase: 'Credits purchased',
  promo: 'Starter grant',
  payout_debit: 'Withdrawn to wallet',
  plan_purchase: 'Plan upgrade',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

export default function UserDashboard() {
  const { data: me, isLoading } = useMe();

  const { data: ledger } = useQuery<Ledger>({
    queryKey: ['credits'],
    queryFn: () => api<Ledger>('/me/credits'),
    enabled: Boolean(me),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-10">
        <Skeleton className="h-8 w-48" />
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
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to see your dashboard</h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-relaxed">
          Use the sign-in menu in the header. While Privy keys are not configured, it offers the
          seeded development accounts.
        </p>
      </div>
    );
  }

  const earned = (ledger?.transactions ?? []).filter((t) => t.type === 'reward_earned');
  const earnedTotal = earned.reduce((sum, t) => sum + Number(t.amountMicro), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me.user.displayName ?? 'Your dashboard'}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Credits are the only currency. They pay for inference, and sponsored content pays them
          back.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="AI credits"
          value={formatCredits(me.credits.balanceMicro)}
          hint="Spendable on inference"
        />
        <StatCard
          label="Earned from ads"
          value={formatCredits(earnedTotal)}
          hint="Your 70% share of confirmed attention"
          accent
        />
        <StatCard
          label="Withdrawable"
          value={formatCredits(me.credits.withdrawableMicro)}
          hint="Earnings only, not purchased credits"
        />
        <StatCard
          label="Tokens today"
          value={me.usageToday.todayTokens.toLocaleString()}
          hint={`${me.usageToday.requestCount} request${me.usageToday.requestCount === 1 ? '' : 's'}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit history</CardTitle>
        </CardHeader>
        <CardContent>
          {!ledger || ledger.transactions.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nothing yet. Ask a question in the VS Code extension to see credits move.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.transactions.map((tx) => {
                    const amount = Number(tx.amountMicro);
                    return (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <span className="text-sm">{TYPE_LABEL[tx.type] ?? tx.type}</span>
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                          }`}
                        >
                          {amount > 0 ? '+' : '−'}
                          {formatCredits(Math.abs(amount))}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {formatCredits(tx.balanceAfterMicro)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs">
                          {new Date(tx.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What advertisers can target you on</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {me.profile?.persona && <Badge variant="secondary">{me.profile.persona}</Badge>}
            {(me.profile?.technologies ?? []).map((tech) => (
              <Badge key={tech} variant="secondary">
                {tech}
              </Badge>
            ))}
            {(me.profile?.interests ?? []).map((interest) => (
              <Badge key={interest} variant="outline">
                {interest}
              </Badge>
            ))}
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This is the complete list. Your prompts, your code and your identity are never shared,
            and no advertiser can see an individual user at all.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
