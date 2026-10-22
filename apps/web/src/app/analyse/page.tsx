import type { Metadata } from 'next';
import { Prefetch } from '../../lib/prefetch';
import { q } from '../../lib/queries';
import { AnalyseView } from './AnalyseView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Analyse a match' };

export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return (
    <Prefetch queries={[q.teams()]}>
      <AnalyseView initialMode={mode === 'simulate' ? 'simulate' : 'upload'} />
    </Prefetch>
  );
}
