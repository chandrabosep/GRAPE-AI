import type { Metadata } from 'next';

/* Title only. The page itself is a client component, which cannot export
   metadata, so the segment's layout carries it. */
export const metadata: Metadata = {
  title: 'Advertise',
  description: 'Reach developers at the moment they are choosing a tool, targeted on derived intent and real onchain history.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
