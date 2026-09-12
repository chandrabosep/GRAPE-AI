'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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
      <div className="mx-auto max-w-xl p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Withdraw earnings</CardTitle>
          <CardDescription>
            Paid as {info?.asset.symbol} on Hedera testnet. Only credits earned from sponsored
            content can be withdrawn — purchased credits pay for AI requests but never leave as
            money.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg border p-4">
            <div className="text-muted-foreground text-sm">Available to withdraw</div>
            <div className="text-3xl font-semibold tabular-nums">
              {formatCredits(info?.withdrawableMicro, 2)}
            </div>
          </div>

          {!info?.enabled && (
            <Alert>
              <AlertTitle>Withdrawals are not configured</AlertTitle>
              <AlertDescription>
                This deployment has no reward pool or operator key set.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmount((Number(withdrawable) / 1_000_000).toFixed(2))}
              >
                Max
              </Button>
            </div>
            {amount && !amountValid && (
              <p className="text-destructive text-sm">
                {amountMicro > withdrawable
                  ? 'More than your withdrawable balance.'
                  : 'Enter an amount above zero.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Hedera account (EVM address)</Label>
            <Input
              id="address"
              placeholder="0x…"
              value={address}
              spellCheck={false}
              onChange={(event) => setAddress(event.target.value.trim())}
            />
            {address && !addressValid && (
              <p className="text-destructive text-sm">
                That is not a 20-byte EVM address. A Hedera account id like 0.0.1234 has an EVM
                address on its HashScan page.
              </p>
            )}
          </div>

          <Button
            className="w-full"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Sending…' : 'Withdraw'}
          </Button>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>Withdrawal failed</AlertTitle>
              <AlertDescription>
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Something went wrong.'}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Sent</CardTitle>
            <CardDescription>
              {formatCredits(result.amountMicro, 2)} to {result.to}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              className="text-primary text-sm underline underline-offset-4"
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              View on HashScan
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
