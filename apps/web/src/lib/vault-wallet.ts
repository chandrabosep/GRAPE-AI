'use client';

import { decodeFunctionResult, encodeFunctionData, erc20Abi, numberToHex, parseAbi } from 'viem';
import { describe, FALLBACK_GAS, TopupWalletError } from './topup-wallet';
import type { Eip1193Provider } from './wallet';

/**
 * Funding a campaign from the advertiser's own wallet.
 *
 * `CampaignVault.fund` is permissionless and pulls with `transferFrom`, so the
 * advertiser deposits directly and nobody here ever custodies their money. That
 * costs one extra transaction: ERC-20 needs an allowance before anything can
 * pull from you, so this is approve-then-fund, and the approve has to be mined
 * before the fund is sent or the fund reverts on a zero allowance.
 *
 * The same shape as `topup-wallet`, and it shares that module's error
 * vocabulary — an advertiser hitting "insufficient HBAR for the fee" deserves
 * the same sentence a developer topping up does.
 */

const VAULT_ABI = parseAbi(['function fund(bytes32 campaignKey, uint256 amount) external']);

/** How long to wait for a transaction before giving up on its receipt. */
const RECEIPT_TIMEOUT_MS = 90_000;
const RECEIPT_POLL_MS = 2_000;

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new TopupWalletError(body.error.message ?? 'The network rejected that call.');
  return body.result as T;
}

/**
 * How much the vault is already allowed to pull.
 *
 * Read over the configured RPC rather than through the wallet, for the reason
 * `readUsdcBalance` gives: `eth_call` on the provider runs on whatever chain
 * the wallet is sitting on, and a wallet on mainnet would answer confidently
 * about the wrong chain.
 */
export async function readAllowance(
  rpcUrl: string,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });

  const result = await rpc<string>(rpcUrl, 'eth_call', [{ to: token, data }, 'latest']);
  if (!result || result === '0x') return 0n;

  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: 'allowance',
    data: result as `0x${string}`,
  }) as bigint;
}

async function send(
  provider: Eip1193Provider,
  tx: Record<string, string>,
): Promise<string> {
  const estimate = await provider
    .request({ method: 'eth_estimateGas', params: [tx] })
    .then((value) => BigInt(value as string))
    .catch(() => null);

  // A fifth over the estimate, as the top-up path does: HTS calls settle above
  // what the relay predicts often enough that a bare estimate reverts.
  tx.gas = numberToHex(estimate ? (estimate * 12n) / 10n : FALLBACK_GAS);

  try {
    return (await provider.request({ method: 'eth_sendTransaction', params: [tx] })) as string;
  } catch (error) {
    throw new TopupWalletError(describe(error));
  }
}

/**
 * Blocks until a transaction is mined.
 *
 * Unavoidable here: the approve must be on chain before the fund is signed, or
 * the vault's `transferFrom` finds no allowance and the advertiser pays a fee
 * for a revert.
 */
export async function waitForReceipt(rpcUrl: string, hash: string): Promise<void> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const receipt = await rpc<{ status?: string } | null>(rpcUrl, 'eth_getTransactionReceipt', [hash]);
    if (receipt) {
      // `status` is 0x0 on a reverted transaction, which is mined but failed.
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new TopupWalletError('That transaction failed on chain. Nothing was charged beyond the fee.');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }

  throw new TopupWalletError(
    'Your transaction has not been mined yet. It may still land — reload this page in a moment.',
  );
}

export interface ApproveInput {
  provider: Eip1193Provider;
  token: string;
  from: string;
  spender: string;
  amountMicro: bigint;
}

/**
 * Approves exactly what is being funded, not an unlimited allowance.
 *
 * An infinite approve would save the advertiser this step on every later
 * top-up, and would also leave a contract standing permission to drain their
 * USDC for as long as they hold any. For a deposit made once per campaign, that
 * is a bad trade.
 */
export async function approveUsdc(input: ApproveInput): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [input.spender as `0x${string}`, input.amountMicro],
  });

  return send(input.provider, { from: input.from, to: input.token, data });
}

export interface FundInput {
  provider: Eip1193Provider;
  vault: string;
  from: string;
  campaignKey: string;
  amountMicro: bigint;
}

/** Deposits into the vault. Additive, so a partial funding can be topped up. */
export async function fundCampaign(input: FundInput): Promise<string> {
  const data = encodeFunctionData({
    abi: VAULT_ABI,
    functionName: 'fund',
    args: [input.campaignKey as `0x${string}`, input.amountMicro],
  });

  return send(input.provider, { from: input.from, to: input.vault, data });
}
