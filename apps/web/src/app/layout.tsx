import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { SiteHeader } from '@/components/app/site-header';
import { SiteFooter } from '@/components/app/site-footer';
import { env } from '@/server/config/index';
import { Providers } from './providers';
import './globals.css';

/*
 * Stand-ins for three licensed faces, each keeping the role the design system
 * gives it.
 *
 * Whyte Inktrap → Inter. The geometric workhorse; it loses the inktrap cuts but
 * keeps the precision, and weight 300 does the editorial lightness the system
 * leans on at display sizes.
 *
 * Whyte Inktrap Mono → JetBrains Mono. This one only has to survive 0.2em
 * tracking at 74px without the letters looking accidental, which it does.
 *
 * GrandSlang → Playfair Display, italic only. The Refero source names Playfair;
 * DESIGN.md's first pick, Tiempos Headline, is not free, and its second, Lora,
 * is a text serif that reads bookish rather than editorial once it is 88px
 * tall. Loaded at italic alone because this face is never used upright here.
 */
const whyte = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-whyte',
  display: 'swap',
});

const whyteMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-whyte-mono',
  display: 'swap',
});

const grandSlang = Playfair_Display({
  subsets: ['latin'],
  weight: ['400'],
  style: ['italic'],
  variable: '--font-grandslang',
  display: 'swap',
});

const DESCRIPTION =
  'A coding assistant denominated in credits, where relevant sponsored content subsidises ' +
  'inference instead of interrupting it. Agents pay per call over x402 on Hedera.';

export const metadata: Metadata = {
  /*
   * `metadataBase` is what turns the icon and card paths below into the
   * absolute URLs a scraper needs — a relative og:image is simply dropped by
   * most of them. It has to be the address the page is actually served from,
   * so it comes from the environment rather than a constant, and falls back to
   * the dev port rather than to a production URL that would make every local
   * share preview point at the deployment.
   */
  metadataBase: new URL(env().NEXT_PUBLIC_APP_URL),
  title: {
    default: 'GRAPE AI — ads that pay for your AI',
    // Page titles supply only their own half; "Advertise" becomes
    // "Advertise — GRAPE AI" without every page restating the product name.
    template: '%s — GRAPE AI',
  },
  description: DESCRIPTION,
  applicationName: 'GRAPE AI',
  keywords: [
    'AI coding assistant',
    'ad-funded inference',
    'x402',
    'Hedera',
    'The Graph',
    'agent payments',
  ],
  openGraph: {
    type: 'website',
    siteName: 'GRAPE AI',
    title: 'GRAPE AI — ads that pay for your AI',
    description: DESCRIPTION,
    url: '/',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GRAPE AI — ads that pay for your AI',
    description: DESCRIPTION,
  },
  // `icon.svg`, `apple-icon.png` and `opengraph-image.png` sit beside this file
  // and Next wires them up on its own; regenerate them with `pnpm icons`.
};

/**
 * The browser chrome, told what colour the page is.
 *
 * Without this, mobile Safari and Chrome paint their address bars white above
 * a page that is near-black, which is the one place the dark-only palette
 * visibly leaks. `colorScheme` does the same job for form controls and
 * scrollbars, which would otherwise render in the OS light theme.
 */
export const viewport: Viewport = {
  themeColor: '#090909',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `dark` is pinned rather than toggled: the palette has no light variant,
    // and the class is what keeps the `dark:` branches inside the shadcn
    // primitives resolving.
    <html
      lang="en"
      className={`dark ${whyte.variable} ${whyteMono.variable} ${grandSlang.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground flex min-h-screen flex-col antialiased">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
