import type { Metadata } from 'next';

/* Title only. The page itself is a client component, which cannot export
   metadata, so the segment's layout carries it. */
export const metadata: Metadata = {
  /* An object, not a string: a plain title would not pass a template down, and
     the pages nested under /app would render bare ("Add credits"). */
  title: {
    default: 'Dashboard',
    template: '%s — GRAPE AI',
  },
  description: 'Your credits, earnings and wallets.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
