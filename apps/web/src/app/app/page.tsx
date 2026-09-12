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
import { api } from '@/lib/api';
import { Credits } from '@/lib/credits';
import { usePublicConfig, type TierConfig } from '@/hooks/use-public-config';
import { useMe, type Me } from '@/hooks/use-session';
import { cn } from '@/lib/utils';

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
  const { data: config } = usePublicConfig();

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
          value={<Credits micro={me.credits.balanceMicro} />}
          hint="Spendable on inference"
        />
        <Metric
          label="Earned from ads"
          value={<Credits micro={earnedTotal} />}
          hint={`Your ${share(me.tier.tier)} share of confirmed attention, as ${me.tier.tier.name}`}
          accent
        />
        <Metric
          label="Withdrawable"
          value={<Credits micro={me.credits.withdrawableMicro} />}
          hint="Earnings only, not purchased credits"
        />
        <Metric
          label="Tokens today"
          value={me.usageToday.todayTokens.toLocaleString()}
          hint={`${me.usageToday.requestCount} request${me.usageToday.requestCount === 1 ? '' : 's'}`}
        />
      </MetricGrid>

      <TierLadder standing={me.tier} ladder={config?.tiers ?? []} />

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
                       * Credit in, credit out. The hue is the fast read down a
                       * column of near-identical numbers; the sign in front of
                       * each one is the reliable one, and stays legible to a
                       * reader who cannot tell the two hues apart.
                       */}
                      <TableCell
                        className={`text-right tabular-nums ${
                          amount > 0 ? 'text-credit-in' : 'text-credit-out'
                        }`}
                      >
                        {amount > 0 ? '+' : '−'}
                        <Credits micro={Math.abs(amount)} />
                      </TableCell>
                      <TableCell className="text-steel text-right tabular-nums">
                        <Credits micro={tx.balanceAfterMicro} />
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

/** A rung's share, written the way the rest of the product writes a split. */
function share(tier: TierConfig): string {
  return `${Math.round(tier.rewardShare * 100)}%`;
}

/**
 * The earning ladder.
 *
 * Rendered as the whole ladder rather than as the one rung the developer is on,
 * because the number that changes behaviour is the next one up, not the current
 * one. A badge saying "Vine" is a label; three rungs with the rung above lit and
 * a count of what it takes to reach it is the reason to keep using the product.
 *
 * The rungs share their strokes with the metric panel above — this is the same
 * instrument, read down instead of across.
 */
function TierLadder({ standing, ladder }: { standing: Me['tier']; ladder: TierConfig[] }) {
  // Until the public config lands there is still one rung worth showing: the
  // one the server already told us the developer is standing on.
  const rungs = ladder.length > 0 ? ladder : [standing.tier];

  return (
    <section className="mt-24">
      <Stamp
        size="section"
        sub={
          standing.next
            ? `${standing.toNext} more rewarded ad${standing.toNext === 1 ? '' : 's'} and your share rises to ${share(standing.next)}. The extra comes out of the platform's cut — an advertiser is charged the same whoever sees their campaign.`
            : `You are at the top of the ladder. ${share(standing.tier)} of every charge is yours, which is the most the platform can give up and still run.`
        }
      >
        Your tier
      </Stamp>

      <div className="mt-10">
        {standing.next && (
          <div className="mb-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="stamp-sm">
                {standing.tier.name} → {standing.next.name}
              </div>
              <div className="text-steel text-sm tabular-nums">
                {standing.rewardCount} / {standing.next.minRewards} rewarded ads
              </div>
            </div>
            {/*
             * A bare div rather than the Progress primitive: this meter is
             * read alongside a value that is already written above it, so the
             * component's own label and value rows would repeat it.
             */}
            <div className="bg-wash-strong mt-4 h-[3px] w-full overflow-hidden rounded-full">
              <div
                className="bg-signal-violet h-full transition-all"
                style={{ width: `${Math.round(standing.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        <ul className="border-hairline border-t">
          {rungs.map((rung) => {
            const standingHere = rung.level === standing.tier.level;
            const reached = rung.level <= standing.tier.level;

            return (
              <li
                key={rung.level}
                className="border-hairline grid gap-x-6 gap-y-2 border-b py-6 sm:grid-cols-[auto_1fr_auto] sm:items-baseline"
              >
                <div className="stamp-sm flex items-center gap-3">
                  <span
                    className={cn(
                      'inline-block size-1.5 rounded-full',
                      standingHere ? 'bg-signal-violet' : reached ? 'bg-steel' : 'bg-wash-strong',
                    )}
                  />
                  <span className={standingHere ? 'text-almost-white' : undefined}>
                    {rung.name}
                  </span>
                  {standingHere && <span className="text-signal-violet">· you</span>}
                </div>

                <p
                  className={cn(
                    'text-sm leading-relaxed',
                    reached ? 'text-steel' : 'text-graphite',
                  )}
                >
                  {rung.blurb}
                  {rung.minRewards > 0 && ` From ${rung.minRewards} rewarded ads.`}
                </p>

                <div
                  className={cn(
                    'text-[22px] leading-none font-light tracking-[-0.02em] tabular-nums sm:text-right',
                    standingHere
                      ? 'text-signal-violet'
                      : reached
                        ? 'text-almost-white'
                        : 'text-graphite',
                  )}
                >
                  {share(rung)}
                  {rung.dailyCapMultiplier > 1 && (
                    <span className="text-steel ml-2 align-[0.15em] text-xs">
                      ×{rung.dailyCapMultiplier} daily cap
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
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
