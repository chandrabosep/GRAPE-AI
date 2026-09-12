import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { SiteHeader } from '@/components/app/site-header';
import { SiteFooter } from '@/components/app/site-footer';
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

export const metadata: Metadata = {
  title: 'AI Attention Marketplace',
  description: 'Ads that pay for your AI. Relevant sponsored content subsidises inference.',
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
