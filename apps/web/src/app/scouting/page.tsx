import type { Metadata } from 'next';
import { ScoutingView } from './ScoutingView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scouting' };

export default function Page() {
  return <ScoutingView />;
}
