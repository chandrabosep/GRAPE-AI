'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { AppKitProvider } from '@/lib/appkit';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Rewards land asynchronously after an ad is confirmed, so keep data
            // fresh enough that a balance visibly moves without a manual reload.
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  // wagmi sits inside the query client: AppKit's adapter uses react-query.
  //
  // The theme is forced dark rather than following the OS. This palette is a
  // midnight canvas with one violet flare and has no light counterpart; a
  // light mode would mean inventing nine colours the design system never
  // sanctions. ThemeProvider stays because AppKit's modal reads the resolved
  // theme from it — dropping it would leave the wallet dialog light.
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false} disableTransitionOnChange>
        <AppKitProvider>{children}</AppKitProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
