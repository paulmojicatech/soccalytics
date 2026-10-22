import type { Metadata } from 'next';
import { Prefetch } from '../../../lib/prefetch';
import { q } from '../../../lib/queries';
import { PlayerProfileView } from './PlayerProfileView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Player profile' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Prefetch queries={[q.player(id), q.playerTrend(id), q.playerBenchmark(id, 'position_peers')]}>
      <PlayerProfileView id={id} />
    </Prefetch>
  );
}
