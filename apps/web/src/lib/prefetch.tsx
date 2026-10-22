import { HydrationBoundary, QueryClient, dehydrate, type FetchQueryOptions } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Server-side prefetch: runs the given queries during the RSC render and
 * hydrates the client cache. Failures (e.g. API offline) are swallowed here;
 * the client component retries and renders the friendly error state.
 */
export async function Prefetch({
  queries,
  children,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queries: FetchQueryOptions<any, any, any, any>[];
  children: ReactNode;
}) {
  const client = new QueryClient();
  await Promise.all(queries.map((opts) => client.prefetchQuery(opts)));
  return <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>;
}
