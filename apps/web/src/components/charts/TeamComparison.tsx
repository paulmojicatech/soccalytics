import type { TeamMatchStats } from '@soccalytics/contracts';
import { asPct, fmt } from '../../lib/format';
import { SeriesKey } from '../ui';

interface Row {
  label: string;
  home: number;
  away: number;
  format: (n: number) => string;
  note?: string;
  lowerIsBetter?: boolean;
}

function rows(h: TeamMatchStats, a: TeamMatchStats): Row[] {
  const pct = (n: number) => fmt.pct(n);
  return [
    { label: 'Possession', home: asPct(h.possessionPct), away: asPct(a.possessionPct), format: pct },
    { label: 'Expected goals (xG)', home: h.xg, away: a.xg, format: (n) => n.toFixed(2) },
    { label: 'Shots', home: h.shots, away: a.shots, format: fmt.int },
    { label: 'Passes', home: h.passes, away: a.passes, format: fmt.int },
    { label: 'Pass accuracy', home: asPct(h.passAccuracy), away: asPct(a.passAccuracy), format: pct },
    {
      label: 'PPDA',
      home: h.ppda,
      away: a.ppda,
      format: (n) => n.toFixed(1),
      note: 'lower = more intense press',
      lowerIsBetter: true,
    },
    { label: 'Field tilt', home: asPct(h.fieldTilt), away: asPct(a.fieldTilt), format: pct },
    { label: 'Progressive passes', home: h.progressivePasses, away: a.progressivePasses, format: fmt.int },
    { label: 'Pressures', home: h.pressures, away: a.pressures, format: fmt.int },
    { label: 'High regains', home: h.highRegains, away: a.highRegains, format: fmt.int },
    { label: 'Distance covered', home: h.distanceKm, away: a.distanceKm, format: (n) => `${n.toFixed(1)} km` },
  ];
}

/**
 * Mirrored bars from a shared centre baseline: home grows left (blue), away
 * grows right (orange). Every value is direct-labelled at the bar end.
 */
export function TeamComparison({
  home,
  away,
  homeName,
  awayName,
}: {
  home: TeamMatchStats;
  away: TeamMatchStats;
  homeName: string;
  awayName: string;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <SeriesKey color="var(--home)" label={homeName} />
        <SeriesKey color="var(--away)" label={awayName} />
      </div>
      <div className="flex flex-col gap-3.5">
        {rows(home, away).map((r) => {
          const max = Math.max(r.home, r.away, 1e-9);
          const better = r.home === r.away ? null : (r.home > r.away) !== !!r.lowerIsBetter ? 'home' : 'away';
          return (
            <div key={r.label}>
              <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 text-sm">
                <span className={`tabular text-left ${better === 'home' ? 'font-semibold text-text' : 'text-text-2'}`}>
                  {r.format(r.home)}
                </span>
                <span className="text-center text-xs text-muted">
                  {r.label}
                  {r.note && <span className="hidden sm:inline"> · {r.note}</span>}
                </span>
                <span className={`tabular text-right ${better === 'away' ? 'font-semibold text-text' : 'text-text-2'}`}>
                  {r.format(r.away)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
                <div className="flex h-2 justify-end rounded-l bg-surface-2">
                  <div className="h-full rounded-l" style={{ width: `${(r.home / max) * 100}%`, background: 'var(--home)' }} />
                </div>
                <div className="flex h-2 rounded-r bg-surface-2">
                  <div className="h-full rounded-r" style={{ width: `${(r.away / max) * 100}%`, background: 'var(--away)' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
