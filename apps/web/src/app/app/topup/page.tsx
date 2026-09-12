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
 *
 * Laid out as a numbered procedure rather than a form in a card, because it is
 * a procedure: the two steps happen in two different applications, and the
 * field at the end is only reachable once the first one is done elsewhere.
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
      <Shell className="max-w-2xl space-y-6 py-16">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    );
  }

  return (
    <Shell className="max-w-2xl py-16 md:py-24">
      <Eyebrow>Add credits</Eyebrow>
      <h1 className="mt-7 text-balance">
        <span className="display-serif text-almost-white block text-[clamp(2.5rem,7vw,4.5rem)]">
          One dollar,
        </span>
        <span className="text-almost-white mt-1 block text-[clamp(1.5rem,3.6vw,2.25rem)] leading-tight font-light tracking-[-0.03em]">
          one dollar of credits
        </span>
      </h1>
      <p className="text-steel mt-6 text-[15px] leading-relaxed">
        Send {info?.token.symbol ?? 'USDC'} on Hedera testnet, then paste the transaction. No
        conversion, no fee.
      </p>

      {/* The balance as a stamped readout, sharing the page's left edge with
          everything else rather than boxed off in a card of its own. */}
      <div className="border-hairline mt-12 flex flex-wrap items-end justify-between gap-4 border-y py-7">
        <div>
          <div className="stamp-sm">Current balance</div>
          <div className="text-almost-white mt-3 text-[40px] leading-none font-light tracking-[-0.03em] tabular-nums">
            {formatCredits(info?.balanceMicro, 2)}
          </div>
        </div>
        <div className="stamp-sm text-right">{info?.network ?? 'hedera testnet'}</div>
      </div>

      {!info?.enabled ? (
        <Alert className="mt-10">
          <AlertTitle>Top-ups are not configured</AlertTitle>
          <AlertDescription>This deployment has no treasury account set.</AlertDescription>
        </Alert>
      ) : (
        <ol className="mt-12 space-y-12">
          <li>
            <div className="flex items-baseline gap-5">
              <span className="stamp-sm shrink-0">01</span>
              <span className="text-almost-white text-lg font-light">
                Send USDC to this account
              </span>
            </div>
            <div className="mt-5 ml-0 flex items-center gap-3 md:ml-[3.25rem]">
              <code className="border-hairline bg-wash text-lavender-mist min-w-0 flex-1 truncate rounded-[10.8px] border px-4 py-3 font-mono text-sm">
                {info.treasuryAccountId}
              </code>
              <Button type="button" variant="secondary" onClick={copyTreasury}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-graphite mt-3 text-xs leading-relaxed md:ml-[3.25rem]">
              Token {info.token.id} on {info.network}. Sending any other token, or sending on
              another network, cannot be credited.
            </p>
          </li>

          <li>
            <div className="flex items-baseline gap-5">
              <span className="stamp-sm shrink-0">02</span>
              <span className="text-almost-white text-lg font-light">Paste the transaction</span>
            </div>
            <p className="text-graphite mt-3 text-xs leading-relaxed md:ml-[3.25rem]">
              Either form works — the <code className="font-mono">0x…</code> hash a MetaMask-style
              wallet gives you, or the <code className="font-mono">0.0.x@…</code> id from HashPack.
            </p>
            <div className="mt-6 space-y-3 md:ml-[3.25rem]">
              <Label htmlFor="tx">Transaction</Label>
              <Input
                id="tx"
                placeholder="0x… or 0.0.1234@1700000000.000000000"
                value={txId}
                spellCheck={false}
                className="font-mono"
                onChange={(event) => setTxId(event.target.value)}
              />
            </div>
          </li>
        </ol>
      )}

      <Button
        size="lg"
        className="mt-12 w-full"
        disabled={!info?.enabled || txId.trim().length < 5 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Verifying…' : 'Credit my account'}
      </Button>

      {mutation.isError && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Could not credit that transaction</AlertTitle>
          <AlertDescription>
            {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong.'}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="mt-6">
          <AlertTitle>Added {formatCredits(result.creditedMicro, 2)}</AlertTitle>
          <AlertDescription>
            New balance {formatCredits(result.balanceMicro, 2)}. Transaction {result.txId}.
          </AlertDescription>
        </Alert>
      )}
    </Shell>
  );
}
