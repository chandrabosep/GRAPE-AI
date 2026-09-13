import type { Metadata } from 'next';

/* Title only. The page itself is a client component, which cannot export
   metadata, so the segment's layout carries it. */
export const metadata: Metadata = {
  title: 'Withdraw earnings',
  description: 'Withdraw earned credits as USDC on Hedera testnet.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
