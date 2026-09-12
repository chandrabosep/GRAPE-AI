'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Eyebrow, Shell } from '@/components/app/section';
import { api, ApiError } from '@/lib/api';
import { Credits, formatCredits, formatUsdc } from '@/lib/credits';
import { cn } from '@/lib/utils';
import type { Eip1193Provider } from '@/lib/wallet';
import { ensureChain, readUsdcBalance, sendUsdc, TopupWalletError } from '@/lib/topup-wallet';

interface TopupInfo {
  balanceMicro: string;
  treasuryAccountId: string | null;
  treasuryAddress: string | null;
  token: { id: string; address: string; symbol: string; decimals: number };
  network: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  enabled: boolean;
}

interface TopupResult {
  creditedMicro: string;
  balanceMicro: string;
  txId: string;
}

interface ClaimResult {
  claimed: { txId: string; creditedMicro: string }[];
  creditedMicro: string;
  balanceMicro: string;
}

const PRESETS = [5, 10, 25, 50];

/** What the button says while the payment is in flight. */
const STAGE_LABEL: Record<string, string> = {
  chain: 'Switching network…',
  signing: 'Confirm in your wallet',
  sending: 'Sending…',
  crediting: 'Confirming on Hedera…',
};

type Stage = 'idle' | 'chain' | 'signing' | 'sending' | 'crediting';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Round amounts stay round; anything with cents shows both of them. */
const dollarLabel = (value: number) =>
  Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;

/**
 * Buying credits.
 *
 * The old version of this page was a procedure: copy an address, leave for your
 * wallet, come back with a receipt and paste it. Every one of those steps was a
 * place to mistype something or give up, and none of them were load-bearing —
 * the wallet that signed the user in can make the payment itself.
 *
 * So there is one decision on this page (how much) and one action (pay). The
 * transfer, the network switch and the receipt are the page's problem, not the
 * user's. Anything sent from elsewhere is swept up automatically against the
 * wallets they have proved they own, and the old paste-a-transaction field
 * survives only as a disclosure at the bottom for the case where neither works.
 */
export default function TopupPage() {
  const queryClient = useQueryClient();
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');

  const [dollars, setDollars] = useState(10);
  const [custom, setCustom] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopupResult | null>(null);
  /** Kept so a crediting failure can be retried without paying twice. */
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTx, setManualTx] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: info, isLoading } = useQuery<TopupInfo>({
    queryKey: ['topup-info'],
    queryFn: () => api<TopupInfo>('/me/topup'),
  });

  const amountMicro = BigInt(Math.round(dollars * 1_000_000));

  // What the connected wallet can actually spend. Knowing this up front is what
  // lets the page refuse an amount before the wallet does, which is the
  // difference between a disabled button and a failed transaction.
  const { data: walletMicro, refetch: refetchWallet } = useQuery({
    queryKey: ['usdc-balance', address, info?.token.address],
    enabled: Boolean(address && info?.token.address),
    queryFn: () => readUsdcBalance(info!.rpcUrl, info!.token.address, address!),
    staleTime: 10_000,
  });

  /** Everything that shows a balance is now stale; the wallet's is too. */
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: ['topup-info'] });
    void queryClient.invalidateQueries({ queryKey: ['credits'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void refetchWallet();
  };

  /**
   * Sweeps for USDC already sent but never credited.
   *
   * Runs once on load so a payment whose receipt was lost — a closed tab, a
   * send made from a phone — appears as credits without the user doing
   * anything or even knowing something went wrong.
   */
  const claim = useMutation({
    mutationFn: () => api<ClaimResult>('/me/topup/claim', { method: 'POST' }),
    onSuccess: (data) => {
      if (data.claimed.length === 0) return;
      settle();
      toast.success(`Credited ${formatCredits(data.creditedMicro, 2)} you had already sent`);
    },
  });

  const swept = useRef(false);
  useEffect(() => {
    if (swept.current || !info?.enabled) return;
    swept.current = true;
    claim.mutate();
  }, [info?.enabled, claim]);

  /** Hands the hash to the server, which verifies it against the mirror node. */
  async function credit(hash: string) {
    setStage('crediting');
    setPendingHash(hash);
    try {
      const credited = await api<TopupResult>('/me/topup', {
        method: 'POST',
        body: JSON.stringify({ txId: hash }),
      });
      setResult(credited);
      setPendingHash(null);
      settle();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The payment went through but crediting it failed.',
      );
    } finally {
      setStage('idle');
    }
  }

  async function pay() {
    if (!info?.enabled || !info.treasuryAddress) return;
    if (!walletProvider || !address) {
      await open({ view: 'Connect' });
      return;
    }

    setError(null);
    setResult(null);

    try {
      setStage('chain');
      await ensureChain(walletProvider, {
        chainId: info.chainId,
        rpcUrl: info.rpcUrl,
        explorerUrl: info.explorerUrl,
      });

      setStage('signing');
      const hash = await sendUsdc({
        provider: walletProvider,
        token: info.token.address,
        from: address,
        to: info.treasuryAddress,
        amountMicro,
      });

      setStage('sending');
      await credit(hash);
    } catch (caught) {
      setError(
        caught instanceof TopupWalletError || caught instanceof Error
          ? caught.message
          : 'Your wallet could not complete the payment.',
      );
      setStage('idle');
    }
  }

  const manual = useMutation({
    mutationFn: () =>
      api<TopupResult>('/me/topup', {
        method: 'POST',
        body: JSON.stringify({ txId: manualTx.trim() }),
      }),
    onSuccess: (data) => {
      setResult(data);
      setManualTx('');
      settle();
    },
  });

  async function copyTreasury() {
    const value = info?.treasuryAddress ?? info?.treasuryAccountId;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
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

  const busy = stage !== 'idle';
  const insufficient = walletMicro !== undefined && walletMicro < amountMicro;
  /** The whole wallet, rounded down to cents so the send can never exceed it. */
  const spendable = Math.floor(Number(walletMicro ?? 0n) / 10_000) / 100;
  const symbol = info?.token.symbol ?? 'USDC';

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
        Paid in {symbol} from the wallet you signed in with. No conversion, no fee, no receipt to
        hand back.
      </p>

      {/* The balance as a stamped readout, sharing the page's left edge with
          everything else rather than boxed off in a card of its own. */}
      <div className="border-hairline mt-12 flex flex-wrap items-end justify-between gap-4 border-y py-7">
        <div>
          <div className="stamp-sm">Current balance</div>
          <div className="text-almost-white mt-3 text-[40px] leading-none font-light tracking-[-0.03em]">
            <Credits micro={info?.balanceMicro} digits={2} />
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
        <>
          {/* The one decision on the page. Amounts are buttons rather than a
              field because four taps cover almost every top-up, and the field
              is there for the fifth. */}
          <div className="mt-12">
            <div className="stamp-sm">Amount</div>
            <div className="mt-5 flex flex-wrap gap-3">
              {PRESETS.map((value) => {
                const active = !custom && dollars === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setCustom('');
                      setDollars(value);
                    }}
                    className={cn(
                      'border-hairline rounded-[10.8px] border px-6 py-3 text-lg font-light tabular-nums transition-colors',
                      active
                        ? 'border-lavender-mist/60 bg-lavender-mist/10 text-almost-white'
                        : 'text-steel hover:text-almost-white hover:border-lavender-mist/30',
                    )}
                  >
                    ${value}
                  </button>
                );
              })}
              <Input
                inputMode="decimal"
                placeholder="Other"
                value={custom}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^0-9.]/g, '');
                  setCustom(next);
                  const parsed = Number.parseFloat(next);
                  if (Number.isFinite(parsed) && parsed > 0) setDollars(parsed);
                }}
                className="w-28 text-center tabular-nums"
              />
            </div>
          </div>

          {/* Where the money is coming from, stated plainly. A wallet with less
              than the chosen amount is worth knowing about before the wallet
              opens, not after it rejects. */}
          <div className="border-hairline mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
            <div className="text-graphite text-xs">
              {isConnected && address ? (
                <>
                  Paying from <span className="text-steel font-mono">{short(address)}</span>
                  {walletMicro !== undefined && (
                    <>
                      {' · '}
                      <span className={cn('tabular-nums', insufficient ? 'text-red-300' : 'text-steel')}>
                        {formatUsdc(walletMicro)}
                      </span>{' '}
                      available
                    </>
                  )}
                </>
              ) : (
                'No wallet connected'
              )}
            </div>
            {isConnected && (
              <button
                type="button"
                onClick={() => void open({ view: 'Account' })}
                className="stamp-sm text-graphite hover:text-lavender-mist transition-colors"
              >
                Change
              </button>
            )}
          </div>

          <Button
            size="lg"
            className="mt-8 w-full"
            disabled={busy || dollars <= 0 || (isConnected && insufficient)}
            onClick={() => void pay()}
          >
            {busy
              ? STAGE_LABEL[stage]
              : !isConnected
                ? 'Connect a wallet to pay'
                : `Add ${dollarLabel(dollars)}`}
          </Button>

          <p className="text-graphite mt-4 text-xs leading-relaxed">
            {isConnected && insufficient ? (
              <>
                This wallet holds {formatUsdc(walletMicro ?? 0n)} on {info.network}.{' '}
                {spendable > 0 && (
                  // A testnet wallet rarely holds a round number, and every
                  // preset being unaffordable is a dead end. Offering the exact
                  // balance turns it back into one click.
                  <button
                    type="button"
                    onClick={() => {
                      setCustom(spendable.toFixed(2));
                      setDollars(spendable);
                    }}
                    className="text-lavender-mist underline underline-offset-4"
                  >
                    Add {dollarLabel(spendable)} instead
                  </button>
                )}
              </>
            ) : (
              `One transaction, straight to the treasury on ${info.network}. Credits land the moment Hedera confirms it.`
            )}
          </p>
        </>
      )}

      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>{pendingHash ? 'Paid, but not credited yet' : 'Payment failed'}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            {pendingHash && (
              // The money has moved. Re-sending the same hash is the only safe
              // retry — paying again would charge them twice.
              <Button variant="secondary" size="sm" onClick={() => void credit(pendingHash)}>
                Try crediting again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="mt-6">
          <AlertTitle>
            Added <Credits micro={result.creditedMicro} digits={2} />
          </AlertTitle>
          <AlertDescription>
            New balance <Credits micro={result.balanceMicro} digits={2} />.{' '}
            <a
              href={`${info?.explorerUrl}/transaction/${result.txId}`}
              target="_blank"
              rel="noreferrer"
              className="text-lavender-mist underline underline-offset-4"
            >
              View the transaction
            </a>
          </AlertDescription>
        </Alert>
      )}

      {/* The old flow, kept but demoted. It is the answer for an exchange
          withdrawal or a wallet this browser cannot reach, and nothing else. */}
      {info?.enabled && (
        <div className="border-hairline mt-16 border-t pt-8">
          <button
            type="button"
            onClick={() => setManualOpen((value) => !value)}
            className="stamp-sm text-graphite hover:text-lavender-mist transition-colors"
          >
            {manualOpen ? '– ' : '+ '}Sending {symbol} from somewhere else
          </button>

          {manualOpen && (
            <div className="mt-6 space-y-6">
              <div>
                <p className="text-graphite text-xs leading-relaxed">
                  Send token {info.token.id} on {info.network} to the treasury. If it comes from a
                  wallet you have linked, it is credited automatically — otherwise paste the
                  transaction below.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <code className="border-hairline bg-wash text-lavender-mist min-w-0 flex-1 truncate rounded-[10.8px] border px-4 py-3 font-mono text-sm">
                    {info.treasuryAddress ?? info.treasuryAccountId}
                  </code>
                  <Button type="button" variant="secondary" onClick={() => void copyTreasury()}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-graphite mt-2 text-xs">
                  Hedera account {info.treasuryAccountId}
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Input
                  aria-label="Transaction"
                  placeholder="0x… or 0.0.1234@1700000000.000000000"
                  value={manualTx}
                  spellCheck={false}
                  className="min-w-0 flex-1 font-mono"
                  onChange={(event) => setManualTx(event.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={manualTx.trim().length < 5 || manual.isPending}
                  onClick={() => manual.mutate()}
                >
                  {manual.isPending ? 'Verifying…' : 'Credit it'}
                </Button>
              </div>

              {manual.isError && (
                <Alert variant="destructive">
                  <AlertTitle>Could not credit that transaction</AlertTitle>
                  <AlertDescription>
                    {manual.error instanceof ApiError
                      ? manual.error.message
                      : 'Something went wrong.'}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
