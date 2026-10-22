'use client';

import type { TeamMatchStats } from '@soccalytics/contracts';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { SeriesKey } from '../ui';
import { TooltipCard } from './ChartTooltip';

export interface GoalMark {
  side: 'home' | 'away';
  minute: number;
  label: string;
}

function goalDot(color: string) {
  // Ringed ≥8px marker so goals stay legible where they sit on a line.
  return function GoalDot(props: unknown) {
    const { cx, cy } = props as { cx?: number; cy?: number };
    if (cx === undefined || cy === undefined) return <g />;
    return <circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />;
  };
}

function xgAt(timeline: { minute: number; xg: number }[], minute: number): number {
  let v = 0;
  for (const p of timeline) {
    if (p.minute <= minute) v = p.xg;
    else break;
  }
  return v;
}

/**
 * Cumulative xG as a step line per team. Goals are marked with ringed dots on
 * the scoring team's line. Single axis; legend carries final totals.
 */
export function XgRace({
  home,
  away,
  homeName,
  awayName,
  goals = [],
}: {
  home: TeamMatchStats;
  away: TeamMatchStats;
  homeName: string;
  awayName: string;
  goals?: GoalMark[];
}) {
  const ht = [...home.xgTimeline].sort((a, b) => a.minute - b.minute);
  const at = [...away.xgTimeline].sort((a, b) => a.minute - b.minute);
  const minutes = Array.from(new Set([0, ...ht.map((p) => p.minute), ...at.map((p) => p.minute)])).sort((a, b) => a - b);
  const data = minutes.map((m) => ({ minute: m, home: xgAt(ht, m), away: xgAt(at, m) }));
  const maxMinute = Math.max(90, ...minutes);
  const homeGoals = goals.filter((g) => g.side === 'home').map((g) => ({ ...g, xg: xgAt(ht, g.minute) }));
  const awayGoals = goals.filter((g) => g.side === 'away').map((g) => ({ ...g, xg: xgAt(at, g.minute) }));

  if (!ht.length && !at.length) {
    return <p className="py-10 text-center text-sm text-muted">No xG timeline available for this match.</p>;
  }

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <SeriesKey color="var(--home)" shape="line" label={`${homeName} · ${home.xg.toFixed(2)} xG`} />
        <SeriesKey color="var(--away)" shape="line" label={`${awayName} · ${away.xg.toFixed(2)} xG`} />
        {goals.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-text-2" /> Goal
          </span>
        )}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="minute"
              type="number"
              domain={[0, maxMinute]}
              ticks={[0, 15, 30, 45, 60, 75, 90].filter((t) => t <= maxMinute)}
              tickFormatter={(m: number) => `${m}'`}
              stroke="var(--axis)"
              tickLine={false}
            />
            <YAxis stroke="var(--axis)" tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(1)} width={44} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as { home: number; away: number } | undefined;
                if (!row || typeof row.home !== 'number') return null;
                return (
                  <TooltipCard
                    title={`${label}'`}
                    rows={[
                      { color: 'var(--home)', label: homeName, value: row.home.toFixed(2) },
                      { color: 'var(--away)', label: awayName, value: row.away.toFixed(2) },
                    ]}
                  />
                );
              }}
            />
            <Line
              type="stepAfter"
              dataKey="home"
              name={homeName}
              stroke="var(--home)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="away"
              name={awayName}
              stroke="var(--away)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Scatter data={homeGoals} dataKey="xg" shape={goalDot('var(--home)')} legendType="none" isAnimationActive={false} />
            <Scatter data={awayGoals} dataKey="xg" shape={goalDot('var(--away)')} legendType="none" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Cumulative expected goals over time. {homeName} finished on {home.xg.toFixed(2)}, {awayName} on {away.xg.toFixed(2)}.
        {goals.map((g) => ` ${g.label}.`).join('')}
      </figcaption>
    </figure>
  );
}
