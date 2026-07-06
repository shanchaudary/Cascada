'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * React Query provider with production-ready defaults.
 * Wraps the entire application to enable server-state management.
 *
 * - staleTime: 30 seconds (data is fresh for 30s before refetch)
 * - gcTime: 5 minutes (unused data cached for 5 minutes)
 * - retry: 2 attempts on failure (with exponential backoff)
 * - refetchOnWindowFocus: disabled to prevent jarring refetches
 * - Network mode: offlineFirst for better UX
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
            refetchOnWindowFocus: false,
            networkMode: 'offlineFirst',
          },
          mutations: {
            retry: 1,
            networkMode: 'offlineFirst',
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
