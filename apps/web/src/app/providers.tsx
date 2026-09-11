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
  // The theme follows the OS by default — the dark palette already exists in
  // globals.css, and a developer tool that ignores a dark desktop looks wrong
  // next to the editor it is meant to sit beside.
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <AppKitProvider>{children}</AppKitProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
