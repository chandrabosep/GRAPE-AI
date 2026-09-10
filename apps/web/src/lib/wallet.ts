'use client';

import { createSiweMessage } from 'viem/siwe';
import { api, storeSession } from './api';

/**
 * Wallet sign-in.
 *
 * Everything speaks EIP-1193, so the same sign-in path serves both an injected
 * browser wallet and a phone scanning a WalletConnect QR code. The only
 * difference is where the provider comes from.
 *
 * WalletConnect's EVM provider is used rather than AppKit's Universal Connector:
 * we only target EVM chains, the Universal Connector pulls in ethers alongside
 * the viem we already use, and AppKit is documented as incompatible with the
 * wagmi major we would otherwise adopt.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

export class WalletError extends Error {}

/** User-facing text for the rejections wallets actually produce. */
function describe(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return 'You rejected the request in your wallet.';
  if (code === -32002) return 'Your wallet already has a pending request. Open it and finish there.';
  return (error as Error)?.message ?? 'Your wallet could not complete the request.';
}

async function requestAccount(provider: Eip1193Provider): Promise<string> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address) throw new WalletError('No account was shared by your wallet.');
  return address;
}

async function currentChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

export interface SignInResult {
  address: string;
}

export function walletConnectProjectId(): string | undefined {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;
}

export function isWalletConnectAvailable(): boolean {
  return Boolean(walletConnectProjectId());
}

/**
 * Opens the WalletConnect QR modal and returns the connected provider.
 *
 * Imported lazily so the relay client and modal are only downloaded when
 * somebody actually chooses WalletConnect, rather than being carried by every
 * page load.
 */
export async function connectWalletConnect(): Promise<Eip1193Provider> {
  const projectId = walletConnectProjectId();
  if (!projectId) {
    throw new WalletError(
      'WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.',
    );
  }

  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);

  const provider = await EthereumProvider.init({
    projectId,
    // optionalChains rather than chains: a wallet that cannot switch to our
    // chain can still connect and sign, which is all sign-in needs.
    optionalChains: [chainId],
    showQrModal: true,
    methods: ['personal_sign', 'eth_sendTransaction'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'AI Attention Marketplace',
      description: 'Ads that pay for your AI.',
      url: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
      icons: [],
    },
  });

  try {
    await provider.connect();
  } catch (error) {
    throw new WalletError(describe(error));
  }

  return provider as unknown as Eip1193Provider;
}

/**
 * Full sign-in: connect, fetch a server nonce, sign, exchange for a session.
 *
 * The nonce comes from the server because that is the only thing making the
 * signature non-replayable; a client-generated one would prove nothing.
 */
export async function signInWithWallet(provider?: Eip1193Provider): Promise<SignInResult> {
  const wallet = provider ?? window.ethereum;
  if (!wallet) {
    throw new WalletError(
      'No wallet detected. Install a browser wallet, or use the development sign-in.',
    );
  }

  let address: string;
  let chainId: number;
  try {
    address = await requestAccount(wallet);
    chainId = await currentChainId(wallet);
  } catch (error) {
    throw new WalletError(describe(error));
  }

  const { nonce } = await api<{ nonce: string }>('/auth/siwe/nonce');

  const message = createSiweMessage({
    address: address as `0x${string}`,
    chainId,
    domain: window.location.host,
    nonce,
    uri: window.location.origin,
    version: '1',
    statement:
      'Sign in to AI Attention Marketplace. This proves you control this wallet and grants no spending permission.',
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 10 * 60 * 1000),
  });

  let signature: string;
  try {
    signature = (await wallet.request({
      method: 'personal_sign',
      params: [message, address],
    })) as string;
  } catch (error) {
    throw new WalletError(describe(error));
  }

  const session = await api<{ accessToken: string; refreshToken: string }>('/auth/siwe/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  });

  storeSession(session);
  return { address };
}
