import { Prefetch } from '../lib/prefetch';
import { q } from '../lib/queries';
import { OverviewView } from './OverviewView';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Prefetch queries={[q.overview()]}>
      <OverviewView />
    </Prefetch>
  );
}
