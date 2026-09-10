'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  return (
    <QueryClientProvider client={client}>
      <AppKitProvider>{children}</AppKitProvider>
    </QueryClientProvider>
  );
}
