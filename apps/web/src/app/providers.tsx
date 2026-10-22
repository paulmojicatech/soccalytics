'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '../lib/api';
import { RoleProvider } from '../lib/role';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't hammer an API that isn't running; don't retry 4xx.
            retry: (count, err) => {
              if (err instanceof ApiRequestError && (err.offline || (err.status >= 400 && err.status < 500)))
                return count < 1 && err.offline;
              return count < 2;
            },
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <RoleProvider>{children}</RoleProvider>
    </QueryClientProvider>
  );
}
