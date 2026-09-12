'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { hederaTestnet } from '@reown/appkit/networks';
import { WagmiProvider } from 'wagmi';
import type { ReactNode } from 'react';

/**
 * Reown AppKit — the wallet modal.
 *
 * The wagmi adapter is used rather than the ethers one because wagmi is
 * viem-native and this project already runs on viem; the ethers adapter makes
 * ethers a hard dependency, which would mean carrying two signing libraries.
 *
 * An adapter is not optional. AppKit's adapter-free "core" mode renders the
 * WalletConnect QR code and nothing else — no MetaMask, no extension list —
 * because it never creates an injected connector. The adapter is what brings
 * EIP-6963 discovery, and therefore the installed-wallet list.
 */

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

/**
 * One network, and it is Hedera testnet.
 *
 * Every dollar in this product lives there — credits, campaign funding, x402
 * settlement and payouts — and it must be in this list for a wallet to be able
 * to switch to it when someone buys credits. Offering a second network only
 * creates a state where the app is connected to a chain it can do nothing on:
 * the switch prompt arrives later, mid-payment, instead of at connect time.
 *
 * A mainnet *signal* wallet is unaffected. Sign-in and wallet linking are
 * `personal_sign` signatures, which are chain-agnostic, and onchain signals are
 * read from the indexers by address — so a mainnet address still links and
 * still carries its history while the wallet sits on Hedera testnet.
 */
const networks = [hederaTestnet] as const;

export const wagmiAdapter = new WagmiAdapter({
  networks: [...networks],
  projectId,
  ssr: true,
});

if (projectId) {
  // Must run at module scope, not inside a component.
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...networks],
    defaultNetwork: hederaTestnet,
    projectId,
    metadata: {
      name: 'GRAPE AI',
      description: 'Ads that pay for your AI.',
      url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001',
      icons: [],
    },
    // EIP-6963 discovery is what surfaces MetaMask and friends in the modal.
    enableInjected: true,
    enableEIP6963: true,
    features: { analytics: false, email: false, socials: false },
  });
}

export function isWalletModalConfigured(): boolean {
  return Boolean(projectId);
}

export function AppKitProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiAdapter.wagmiConfig}>{children}</WagmiProvider>;
}
