import type { Metadata } from 'next';
import { Prefetch } from '../../lib/prefetch';
import { q } from '../../lib/queries';
import { PlayersView } from './PlayersView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Players' };

export default function Page() {
  return (
    <Prefetch queries={[q.players(), q.teams()]}>
      <PlayersView />
    </Prefetch>
  );
}
