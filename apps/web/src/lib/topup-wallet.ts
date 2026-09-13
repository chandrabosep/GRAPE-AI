'use client';

import { encodeFunctionData, decodeFunctionResult, erc20Abi, numberToHex } from 'viem';
import type { Eip1193Provider } from './wallet';

/**
 * Paying for credits from the wallet the user is already signed in with.
 *
 * USDC on Hedera is HTS token 0.0.5449 behind an ERC-20 facade, so a top-up is
 * an ordinary `transfer` call and every EVM wallet can make it. That is the
 * whole point: no address to copy, no receipt to paste back, no second app.
 *
 * Everything speaks EIP-1193 here for the same reason sign-in does — one code
 * path serves an injected extension and a phone on WalletConnect alike.
 */

export class TopupWalletError extends Error {}

/** User-facing text for the rejections wallets actually produce. */
export function describe(error: unknown): string {
  const code = (error as { code?: number })?.code;
  const message = (error as { message?: string })?.message ?? '';

  if (code === 4001) return 'You cancelled the payment in your wallet.';
  if (code === -32002) return 'Your wallet already has a pending request. Open it and finish there.';
  if (/insufficient funds|INSUFFICIENT_PAYER_BALANCE/i.test(message)) {
    return 'Your wallet does not have enough HBAR to pay the network fee.';
  }
  if (/INSUFFICIENT_TOKEN_BALANCE|transfer amount exceeds balance/i.test(message)) {
    return 'That is more USDC than this wallet holds.';
  }
  if (/TOKEN_NOT_ASSOCIATED/i.test(message)) {
    return 'This wallet is not associated with USDC on Hedera testnet.';
  }
  return message || 'Your wallet could not complete the payment.';
}

export interface ChainDescriptor {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
}

async function currentChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

/**
 * Moves the wallet to the chain the treasury is on, adding it if it is unknown.
 *
 * A wallet sitting on mainnet is the normal case — a signal wallet is a mainnet
 * address — so switching has to be something the page does rather than
 * something it asks the user to go and do.
 */
export async function ensureChain(
  provider: Eip1193Provider,
  chain: ChainDescriptor,
): Promise<void> {
  if ((await currentChainId(provider)) === chain.chainId) return;

  const chainIdHex = numberToHex(chain.chainId);
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (error) {
    // 4902 is "unrecognised chain". Some wallets report the same condition as a
    // generic internal error, so the add is attempted on any failure and it is
    // the add's own error that surfaces if the chain really cannot be used.
    const code = (error as { code?: number })?.code;
    if (code === 4001) throw new TopupWalletError(describe(error));
  }

  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: 'Hedera Testnet',
          nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerUrl],
        },
      ],
    });
  } catch (error) {
    throw new TopupWalletError(describe(error));
  }

  if ((await currentChainId(provider)) !== chain.chainId) {
    throw new TopupWalletError('Switch your wallet to Hedera testnet to pay.');
  }
}

/**
 * Spendable USDC in a wallet, in base units — which are micro-USD.
 *
 * Read over the treasury's own RPC rather than through the wallet, because
 * `eth_call` on an EIP-1193 provider runs on whatever chain the wallet happens
 * to be sitting on. A wallet on mainnet answers about mainnet, where this
 * address holds nothing, and the page would confidently report a zero balance
 * for someone who has money. The chain the treasury is on is the only chain
 * this question makes sense about.
 */
export async function readUsdcBalance(
  rpcUrl: string,
  token: string,
  owner: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner as `0x${string}`],
  });

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: token, data }, 'latest'],
    }),
  });

  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new TopupWalletError(body.error.message ?? 'Could not read your balance.');

  // An empty return means the wallet has never touched the token, which reads
  // as a zero balance rather than an error worth showing anyone.
  if (!body.result || body.result === '0x') return 0n;

  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: 'balanceOf',
    data: body.result as `0x${string}`,
  }) as bigint;
}

/**
 * A gas limit that works when estimation does not.
 *
 * The HashIO relay frequently refuses to estimate an HTS transfer, and an
 * unestimated send is one MetaMask simply blocks. Unused gas is refunded, so
 * the cost of naming a limit here is nothing next to a payment that cannot be
 * submitted at all.
 */
export const FALLBACK_GAS = 300_000n;

export interface SendUsdcInput {
  provider: Eip1193Provider;
  token: string;
  from: string;
  to: string;
  amountMicro: bigint;
}

/** Sends USDC to the treasury and returns the transaction hash. */
export async function sendUsdc(input: SendUsdcInput): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [input.to as `0x${string}`, input.amountMicro],
  });

  const tx: Record<string, string> = { from: input.from, to: input.token, data };

  const estimate = await input.provider
    .request({ method: 'eth_estimateGas', params: [tx] })
    .then((value) => BigInt(value as string))
    .catch(() => null);

  // A fifth on top of the estimate: HTS calls occasionally settle above what
  // the relay predicts, and a top-up that reverts out of gas costs the user a
  // fee and gives them nothing.
  tx.gas = numberToHex(estimate ? (estimate * 12n) / 10n : FALLBACK_GAS);

  try {
    return (await input.provider.request({
      method: 'eth_sendTransaction',
      params: [tx],
    })) as string;
  } catch (error) {
    throw new TopupWalletError(describe(error));
  }
}
