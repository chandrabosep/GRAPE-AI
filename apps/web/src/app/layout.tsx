import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { SiteHeader } from '@/components/app/site-header';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Attention Marketplace',
  description: 'Ads that pay for your AI. Relevant sponsored content subsidises inference.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
