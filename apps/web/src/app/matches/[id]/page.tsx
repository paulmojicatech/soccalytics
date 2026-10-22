import type { Metadata } from 'next';
import { Prefetch } from '../../../lib/prefetch';
import { q } from '../../../lib/queries';
import { MatchCentre } from './MatchCentre';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Match centre' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return (
    <Prefetch queries={[q.match(id)]}>
      <MatchCentre id={id} initialTab={tab} />
    </Prefetch>
  );
}
