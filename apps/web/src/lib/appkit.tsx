'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { baseSepolia, mainnet, sepolia } from '@reown/appkit/networks';
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

const networks = [baseSepolia, mainnet, sepolia] as const;

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
    defaultNetwork: baseSepolia,
    projectId,
    metadata: {
      name: 'AI Attention Marketplace',
      description: 'Ads that pay for your AI.',
      url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
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
