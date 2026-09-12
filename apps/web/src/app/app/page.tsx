'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Metric, MetricGrid } from '@/components/app/metric';
import { Eyebrow, Shell, Stamp } from '@/components/app/section';
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
      <Shell className="space-y-8 py-16">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-36 w-full" />
      </Shell>
    );
  }

  if (!me) return <SignedOut />;

  const earned = (ledger?.transactions ?? []).filter((t) => t.type === 'reward_earned');
  const earnedTotal = earned.reduce((sum, t) => sum + Number(t.amountMicro), 0);

  return (
    <Shell className="py-16 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        {/*
         * The stamp says "Your ledger", not the account name.
         *
         * A stamp is a signpost for what the page is, and it is set at 74px in
         * letterspaced monospace — a name is neither, and an arbitrary-length
         * one ("Northwind RPC [simulated]") wraps into a two-line shout that
         * tells the reader nothing about where they are. The name belongs in
         * the line underneath, where it is an attribute of the page rather than
         * its title.
         */}
        <Stamp
          as="h1"
          sub={
            <>
              {me.user.displayName ? `${me.user.displayName} · ` : ''}Credits are the only
              currency. They pay for inference, and sponsored content pays them back.
            </>
          }
        >
          Your ledger
        </Stamp>
        <div className="flex gap-3">
          <Button variant="outline" nativeButton={false} render={<Link href="/app/topup" />}>
            Add credits
          </Button>
          <Button variant="secondary" nativeButton={false} render={<Link href="/app/withdraw" />}>
            Withdraw
          </Button>
        </div>
      </div>

      {/* Four readings on one instrument panel, not four cards. */}
      <MetricGrid className="mt-14">
        <Metric
          label="AI credits"
          value={formatCredits(me.credits.balanceMicro)}
          hint="Spendable on inference"
        />
        <Metric
          label="Earned from ads"
          value={formatCredits(earnedTotal)}
          hint="Your 70% share of confirmed attention"
          accent
        />
        <Metric
          label="Withdrawable"
          value={formatCredits(me.credits.withdrawableMicro)}
          hint="Earnings only, not purchased credits"
        />
        <Metric
          label="Tokens today"
          value={me.usageToday.todayTokens.toLocaleString()}
          hint={`${me.usageToday.requestCount} request${me.usageToday.requestCount === 1 ? '' : 's'}`}
        />
      </MetricGrid>

      <section className="mt-24">
        <Stamp size="section">Credit history</Stamp>

        <div className="mt-10">
          {!ledger || ledger.transactions.length === 0 ? (
            <p className="border-hairline text-steel border-t py-16 text-center text-sm">
              Nothing yet. Ask a question in the VS Code extension to see credits move.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-0">Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="pr-0 text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.transactions.map((tx) => {
                  const amount = Number(tx.amountMicro);
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="pl-0 text-sm font-light">
                        {TYPE_LABEL[tx.type] ?? tx.type}
                      </TableCell>
                      {/*
                       * Credit in, credit out. The sign and the position carry
                       * the direction — an earning is not marked with a colour,
                       * because green would be a third hue the palette does not
                       * have and violet is spent elsewhere on this page.
                       */}
                      <TableCell
                        className={`text-right tabular-nums ${
                          amount > 0 ? 'text-almost-white' : 'text-steel'
                        }`}
                      >
                        {amount > 0 ? '+' : '−'}
                        {formatCredits(Math.abs(amount))}
                      </TableCell>
                      <TableCell className="text-steel text-right tabular-nums">
                        {formatCredits(tx.balanceAfterMicro)}
                      </TableCell>
                      <TableCell className="text-graphite pr-0 text-right text-xs tabular-nums">
                        {new Date(tx.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section className="mt-24">
        <Stamp
          size="section"
          sub="This is the complete list. Your prompts, your code and your identity are never shared, and no advertiser can see an individual user at all."
        >
          Your targeting profile
        </Stamp>

        <div className="border-hairline mt-10 flex flex-wrap gap-2 border-t pt-10">
          {me.profile?.persona && <Badge>{me.profile.persona}</Badge>}
          {(me.profile?.technologies ?? []).map((tech) => (
            <Badge key={tech}>{tech}</Badge>
          ))}
          {(me.profile?.interests ?? []).map((interest) => (
            <Badge key={interest} variant="outline">
              {interest}
            </Badge>
          ))}
          {!me.profile?.persona &&
            (me.profile?.technologies ?? []).length === 0 &&
            (me.profile?.interests ?? []).length === 0 && (
              <p className="text-steel text-sm">
                Nothing derived yet — signals appear once you have used the assistant.
              </p>
            )}
        </div>
      </section>
    </Shell>
  );
}

/**
 * The signed-out state.
 *
 * Left-aligned with the rest of the system rather than centred: the page never
 * centres body copy, and an empty state is not a licence to break that.
 */
function SignedOut() {
  return (
    <Shell className="py-28 md:py-36">
      <Eyebrow>Not signed in</Eyebrow>
      <h1 className="display-serif text-almost-white mt-8 max-w-2xl text-[clamp(2.25rem,6vw,4rem)] text-balance">
        Sign in to see your ledger
      </h1>
      <p className="text-steel mt-7 max-w-xl text-[17px] leading-relaxed font-light">
        Connect your wallet from the header to see your credits, your earnings and what advertisers
        can target you on.
      </p>
    </Shell>
  );
}
