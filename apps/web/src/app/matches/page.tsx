import type { Metadata } from 'next';
import { Prefetch } from '../../lib/prefetch';
import { q } from '../../lib/queries';
import { MatchesView } from './MatchesView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Matches' };

export default function Page() {
  return (
    <Prefetch queries={[q.matches()]}>
      <MatchesView />
    </Prefetch>
  );
}
