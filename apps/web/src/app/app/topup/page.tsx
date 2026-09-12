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

interface TopupInfo {
  balanceMicro: string;
  treasuryAccountId: string | null;
  token: { id: string; symbol: string; decimals: number };
  network: string;
  explorerUrl: string;
  enabled: boolean;
}

interface TopupResult {
  creditedMicro: string;
  balanceMicro: string;
  txId: string;
}

/**
 * Buying credits by sending USDC on chain.
 *
 * There is no wallet connection here on purpose. The user sends from whatever
 * wallet they already use and pastes the transaction back; we verify it against
 * the mirror node rather than trusting it, which keeps the product out of the
 * business of custodying keys or asking anyone to approve a contract.
 */
export default function TopupPage() {
  const queryClient = useQueryClient();
  const [txId, setTxId] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<TopupResult | null>(null);

  const { data: info, isLoading } = useQuery<TopupInfo>({
    queryKey: ['topup-info'],
    queryFn: () => api<TopupInfo>('/me/topup'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api<TopupResult>('/me/topup', { method: 'POST', body: JSON.stringify({ txId: txId.trim() }) }),
    onSuccess: (data) => {
      setResult(data);
      setTxId('');
      void queryClient.invalidateQueries({ queryKey: ['topup-info'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
  });

  async function copyTreasury() {
    if (!info?.treasuryAccountId) return;
    try {
      await navigator.clipboard.writeText(info.treasuryAccountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in some contexts; the address is on screen anyway.
    }
  }

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
          <CardTitle>Add credits</CardTitle>
          <CardDescription>
            Send {info?.token.symbol} on Hedera testnet, then paste the transaction. One USDC
            becomes one dollar of credits — no conversion, no fee.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg border p-4">
            <div className="text-muted-foreground text-sm">Current balance</div>
            <div className="text-3xl font-semibold tabular-nums">
              {formatCredits(info?.balanceMicro, 2)}
            </div>
          </div>

          {!info?.enabled ? (
            <Alert>
              <AlertTitle>Top-ups are not configured</AlertTitle>
              <AlertDescription>This deployment has no treasury account set.</AlertDescription>
            </Alert>
          ) : (
            <ol className="space-y-4 text-sm">
              <li>
                <div className="font-medium">1. Send USDC to this account</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="bg-muted flex-1 rounded px-3 py-2 font-mono text-sm">
                    {info.treasuryAccountId}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={copyTreasury}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2">
                  Token {info.token.id} on {info.network}. Sending any other token, or sending on
                  another network, cannot be credited.
                </p>
              </li>
              <li>
                <div className="font-medium">2. Paste the transaction</div>
                <p className="text-muted-foreground mt-1">
                  Either form works — the <code>0x…</code> hash a MetaMask-style wallet gives you,
                  or the <code>0.0.x@…</code> id from HashPack.
                </p>
              </li>
            </ol>
          )}

          <div className="space-y-2">
            <Label htmlFor="tx">Transaction</Label>
            <Input
              id="tx"
              placeholder="0x… or 0.0.1234@1700000000.000000000"
              value={txId}
              spellCheck={false}
              onChange={(event) => setTxId(event.target.value)}
            />
          </div>

          <Button
            className="w-full"
            disabled={!info?.enabled || txId.trim().length < 5 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Verifying…' : 'Credit my account'}
          </Button>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>Could not credit that transaction</AlertTitle>
              <AlertDescription>
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Something went wrong.'}
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert>
              <AlertTitle>Added {formatCredits(result.creditedMicro, 2)}</AlertTitle>
              <AlertDescription>
                New balance {formatCredits(result.balanceMicro, 2)}. Transaction {result.txId}.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
