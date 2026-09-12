'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Eyebrow, Shell } from '@/components/app/section';
import { api, ApiError, formatCredits } from '@/lib/api';

interface WithdrawInfo {
  withdrawableMicro: string;
  asset: { address: string; symbol: string; decimals: number };
  chainId: number;
  explorerUrl: string;
  enabled: boolean;
}

interface WithdrawResult {
  payoutId: string;
  txHash: string;
  amountMicro: string;
  to: string;
  explorerUrl: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Cashing earned credits out as USDC on Hedera.
 *
 * Only credits *earned* from sponsored content can leave as money — purchased
 * credits spend on inference but never withdraw — so the figure shown here is
 * deliberately not the account balance, and the page says why rather than
 * letting someone discover it as a rejection.
 */
export default function WithdrawPage() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<WithdrawResult | null>(null);

  const { data: info, isLoading } = useQuery<WithdrawInfo>({
    queryKey: ['withdraw-info'],
    queryFn: () => api<WithdrawInfo>('/me/withdraw'),
  });

  const withdrawable = BigInt(info?.withdrawableMicro ?? '0');
  const amountMicro = amount ? BigInt(Math.round(Number(amount) * 1_000_000)) : 0n;

  const addressValid = ADDRESS_RE.test(address);
  const amountValid = amountMicro > 0n && amountMicro <= withdrawable;
  const canSubmit = Boolean(info?.enabled) && addressValid && amountValid;

  const mutation = useMutation({
    mutationFn: () =>
      api<WithdrawResult>('/me/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amountMicro: amountMicro.toString(), to: address }),
      }),
    onSuccess: (data) => {
      setResult(data);
      setAmount('');
      void queryClient.invalidateQueries({ queryKey: ['withdraw-info'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
  });

  if (isLoading) {
    return (
      <Shell className="max-w-2xl space-y-6 py-16">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    );
  }

  return (
    <Shell className="max-w-2xl py-16 md:py-24">
      <Eyebrow>Withdraw earnings</Eyebrow>
      <h1 className="mt-7 text-balance">
        <span className="display-serif text-almost-white block text-[clamp(2.5rem,7vw,4.5rem)]">
          What you earned
        </span>
        <span className="text-almost-white mt-1 block text-[clamp(1.5rem,3.6vw,2.25rem)] leading-tight font-light tracking-[-0.03em]">
          paid out as {info?.asset.symbol ?? 'USDC'}
        </span>
      </h1>
      <p className="text-steel mt-6 text-[15px] leading-relaxed text-pretty">
        Only credits earned from sponsored content can be withdrawn. Purchased credits pay for AI
        requests but never leave as money.
      </p>

      {/* The withdrawable figure is the accent number on this page: it is the
          one thing the page exists to answer, so it gets the violet. */}
      <div className="border-hairline mt-12 flex flex-wrap items-end justify-between gap-4 border-y py-7">
        <div>
          <div className="stamp-sm">Available to withdraw</div>
          <div className="text-signal-violet mt-3 text-[40px] leading-none font-light tracking-[-0.03em] tabular-nums">
            {formatCredits(info?.withdrawableMicro, 2)}
          </div>
        </div>
        <div className="stamp-sm text-right">Hedera testnet</div>
      </div>

      {!info?.enabled && (
        <Alert className="mt-10">
          <AlertTitle>Withdrawals are not configured</AlertTitle>
          <AlertDescription>
            This deployment has no reward pool or operator key set.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-12 space-y-10">
        <div className="space-y-3">
          <Label htmlFor="amount">Amount (USD)</Label>
          <div className="flex items-end gap-3">
            <Input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              className="tabular-nums"
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAmount((Number(withdrawable) / 1_000_000).toFixed(2))}
            >
              Max
            </Button>
          </div>
          {amount && !amountValid && (
            <p className="text-destructive text-xs">
              {amountMicro > withdrawable
                ? 'More than your withdrawable balance.'
                : 'Enter an amount above zero.'}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label htmlFor="address">Hedera account (EVM address)</Label>
          <Input
            id="address"
            placeholder="0x…"
            value={address}
            spellCheck={false}
            className="font-mono"
            onChange={(event) => setAddress(event.target.value.trim())}
          />
          {address && !addressValid && (
            <p className="text-destructive text-xs leading-relaxed">
              That is not a 20-byte EVM address. A Hedera account id like 0.0.1234 has an EVM
              address on its HashScan page.
            </p>
          )}
        </div>
      </div>

      <Button
        size="lg"
        className="mt-12 w-full"
        disabled={!canSubmit || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Sending…' : 'Withdraw'}
      </Button>

      {mutation.isError && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Withdrawal failed</AlertTitle>
          <AlertDescription>
            {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong.'}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="border-hairline mt-10 border-t pt-8">
          <div className="stamp-sm">Sent</div>
          <p className="text-almost-white mt-3 text-lg font-light tabular-nums">
            {formatCredits(result.amountMicro, 2)} to{' '}
            <span className="font-mono text-sm">{result.to}</span>
          </p>
          <a
            className="text-lavender-mist mt-4 inline-block text-sm underline underline-offset-4"
            href={result.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on HashScan →
          </a>
        </div>
      )}
    </Shell>
  );
}
