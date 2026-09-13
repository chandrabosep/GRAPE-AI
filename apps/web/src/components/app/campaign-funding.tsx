'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/app/section';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/credits';
import { ensureChain, readUsdcBalance, TopupWalletError } from '@/lib/topup-wallet';
import { approveUsdc, fundCampaign, readAllowance, waitForReceipt } from '@/lib/vault-wallet';
import { isWalletModalConfigured } from '@/lib/appkit';
import type { Eip1193Provider } from '@/lib/wallet';

interface FundingState {
  configured: boolean;
  campaignKey: string;
  vaultAddress: string | null;
  tokenAddress: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  budgetMicro: string;
  depositedMicro: string;
  settledMicro: string;
  outstandingMicro: string;
  funded: boolean;
  advertiserAddress: string | null;
  closed: boolean;
}

type Stage = 'idle' | 'chain' | 'approving' | 'funding' | 'recording';

/** What the button says while the deposit is in flight. */
const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  chain: 'Switching network…',
  approving: 'Approve in your wallet (1 of 2)',
  funding: 'Confirm the deposit (2 of 2)',
  recording: 'Confirming on Hedera…',
};

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Depositing a campaign budget into the vault.
 *
 * The one place the advertiser spends real money, so it says plainly what is
 * about to happen: two wallet prompts, because ERC-20 needs an allowance before
 * the vault can pull, and the exact figure both times.
 *
 * Nothing here decides how much is funded. The panel renders whatever the vault
 * reports holding, so an advertiser who deposited from a different wallet, or
 * closed the tab mid-flow, sees the truth on reload rather than an optimistic
 * number this component invented.
 */
export function CampaignFunding({ campaignId, status }: { campaignId: string; status: string }) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>('idle');

  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');

  const { data: funding, isLoading } = useQuery<FundingState>({
    queryKey: ['campaign', campaignId, 'funding'],
    queryFn: () => api<FundingState>(`/campaigns/${campaignId}/funding`),
  });

  const deposit = useMutation({
    mutationFn: async () => {
      if (!funding?.vaultAddress) throw new TopupWalletError('Funding is not configured.');
      if (!walletProvider || !address) throw new TopupWalletError('Connect a wallet first.');

      const amount = BigInt(funding.outstandingMicro);
      if (amount <= 0n) throw new TopupWalletError('This campaign is already funded.');

      setStage('chain');
      await ensureChain(walletProvider, {
        chainId: funding.chainId,
        rpcUrl: funding.rpcUrl,
        explorerUrl: funding.explorerUrl,
      });

      const balance = await readUsdcBalance(funding.rpcUrl, funding.tokenAddress, address);
      if (balance < amount) {
        throw new TopupWalletError(
          `This wallet holds ${formatUsd(balance, 2)} USDC — ${formatUsd(amount, 2)} is needed.`,
        );
      }

      // Skip the approve when a previous, larger allowance still stands; the
      // advertiser should not sign twice for nothing.
      const allowance = await readAllowance(
        funding.rpcUrl,
        funding.tokenAddress,
        address,
        funding.vaultAddress,
      );

      if (allowance < amount) {
        setStage('approving');
        const approval = await approveUsdc({
          provider: walletProvider,
          token: funding.tokenAddress,
          from: address,
          spender: funding.vaultAddress,
          amountMicro: amount,
        });
        // The approve must be mined before the fund is signed, or the vault's
        // transferFrom finds no allowance and the advertiser pays for a revert.
        await waitForReceipt(funding.rpcUrl, approval);
      }

      setStage('funding');
      const hash = await fundCampaign({
        provider: walletProvider,
        vault: funding.vaultAddress,
        from: address,
        campaignKey: funding.campaignKey,
        amountMicro: amount,
      });
      await waitForReceipt(funding.rpcUrl, hash);

      setStage('recording');
      return api<FundingState>(`/campaigns/${campaignId}/funding`, {
        method: 'POST',
        body: JSON.stringify({ txHash: hash }),
      });
    },
    onSuccess: async (next) => {
      toast.success(`${formatUsd(BigInt(next.depositedMicro), 2)} deposited. You can launch now.`);
      await queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof TopupWalletError || error instanceof Error
          ? error.message
          : 'The deposit could not be completed.',
      );
    },
    onSettled: () => setStage('idle'),
  });

  // A deployment with no vault has nothing to say here, and an ended campaign
  // is past the point of being funded.
  if (isLoading || !funding?.configured || status === 'ended') return null;

  const budget = BigInt(funding.budgetMicro);
  const deposited = BigInt(funding.depositedMicro);
  const outstanding = BigInt(funding.outstandingMicro);
  const busy = deposit.isPending;

  return (
    <section className="mt-20">
      <Stamp
        size="section"
        sub="Your budget is held by the CampaignVault contract on Hedera testnet, not by us. It is released as the campaign spends, and whatever is never spent can be refunded to the wallet that deposited it."
      >
        Funding
      </Stamp>

      <div className="frame mt-12 sm:grid-cols-3">
        <div className="p-6">
          <div className="stamp-sm">Budget</div>
          <div className="text-almost-white mt-3 text-[22px] font-light tabular-nums">
            {formatUsd(budget, 2)}
          </div>
        </div>
        <div className="p-6">
          <div className="stamp-sm">Deposited on chain</div>
          <div className="text-almost-white mt-3 text-[22px] font-light tabular-nums">
            {formatUsd(deposited, 2)}
          </div>
        </div>
        <div className="p-6">
          <div className="stamp-sm">Still to fund</div>
          <div
            className={`mt-3 text-[22px] font-light tabular-nums ${
              outstanding > 0n ? 'text-almost-white' : 'text-steel'
            }`}
          >
            {formatUsd(outstanding, 2)}
          </div>
        </div>
      </div>

      {funding.funded ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="text-steel text-[15px] leading-relaxed">
            Funded in full
            {funding.advertiserAddress && (
              <>
                {' '}
                from <span className="text-almost-white font-mono">
                  {short(funding.advertiserAddress)}
                </span>
              </>
            )}
            .
          </p>
          <a
            href={`${funding.explorerUrl}/contract/${funding.vaultAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-steel hover:text-almost-white text-[15px] underline underline-offset-4 transition-colors"
          >
            View the vault →
          </a>
        </div>
      ) : (
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {isConnected && address ? (
            <Button onClick={() => deposit.mutate()} disabled={busy || outstanding <= 0n}>
              {busy ? STAGE_LABEL[stage] : `Deposit ${formatUsd(outstanding, 2)} USDC`}
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (!isWalletModalConfigured()) {
                  toast.error('Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable wallet funding.');
                  return;
                }
                void open({ view: 'Connect' });
              }}
            >
              Connect a wallet to fund
            </Button>
          )}

          <p className="text-graphite max-w-md text-sm leading-relaxed">
            Two wallet prompts: one to let the vault draw the amount, one to make the deposit.
            Nothing is served until this is funded and the campaign is launched.
          </p>
        </div>
      )}
    </section>
  );
}
