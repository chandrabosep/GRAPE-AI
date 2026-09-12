'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { arcTestnet, mainnet } from '@reown/appkit/networks';
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
 * Arc testnet is where campaign money lives, so it is the default and the first
 * network offered. Mainnet stays in the list because a developer's *signal*
 * wallet is a mainnet address with real history — signing in or linking one
 * must not require switching away from a chain they never transact on.
 */
const networks = [arcTestnet, mainnet] as const;

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
    defaultNetwork: arcTestnet,
    projectId,
    metadata: {
      name: 'AI Attention Marketplace',
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
