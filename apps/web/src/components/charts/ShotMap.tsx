'use client';

import type { MatchEvent } from '@soccalytics/contracts';
import { PITCH } from '@soccalytics/contracts';
import { useState } from 'react';
import { Pitch, toSvgY } from '../Pitch';
import { SeriesKey, Tabs } from '../ui';
import { useMarkTooltip } from './ChartTooltip';

export function eventMinute(e: Pick<MatchEvent, 'period' | 't'>): number {
  const offset = e.period === 1 ? 0 : e.period === 2 ? 45 : e.period === 3 ? 90 : 105;
  return Math.floor(offset + e.t / 60) + 1;
}

const PATTERN_LABEL: Record<string, string> = {
  open_play: 'Open play',
  set_piece: 'Set piece',
  counter: 'Counter-attack',
  penalty: 'Penalty',
};

type Filter = 'both' | 'home' | 'away';

/**
 * Shots on a full pitch: home attacks right, away is mirrored to attack left.
 * Circle area ∝ xG; goals are solid with a surface ring, misses are washed.
 */
export function ShotMap({
  shots,
  homeTeamId,
  homeName,
  awayName,
  playerName,
}: {
  shots: MatchEvent[];
  homeTeamId: string;
  homeName: string;
  awayName: string;
  playerName: (id: string) => string;
}) {
  const [filter, setFilter] = useState<Filter>('both');
  const { containerRef, show, hide, tooltip } = useMarkTooltip();

  const visible = shots
    .filter((s) => filter === 'both' || (filter === 'home') === (s.teamId === homeTeamId))
    // draw large chances first so small ones stay hoverable on top
    .sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0));

  const summary = (side: 'home' | 'away') => {
    const list = shots.filter((s) => (s.teamId === homeTeamId) === (side === 'home'));
    return {
      shots: list.length,
      goals: list.filter((s) => s.success).length,
      xg: list.reduce((acc, s) => acc + (s.xg ?? 0), 0),
      big: list.filter((s) => (s.xg ?? 0) >= 0.3).length,
    };
  };
  const hs = summary('home');
  const as = summary('away');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <SeriesKey color="var(--home)" shape="dot" label={`${homeName} →`} />
          <SeriesKey color="var(--away)" shape="dot" label={`← ${awayName}`} />
          <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-text-2" /> Goal
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-text-2 opacity-60" /> No goal
          </span>
          <span className="text-xs text-muted">Size = xG</span>
        </div>
        <Tabs
          size="sm"
          label="Shot map team filter"
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'both', label: 'Both' },
            { id: 'home', label: homeName },
            { id: 'away', label: awayName },
          ]}
        />
      </div>

      <div ref={containerRef} className="relative mx-auto max-w-5xl">
        <Pitch title={`Shot map: ${homeName} ${hs.shots} shots, ${awayName} ${as.shots} shots`} className="w-full">
          {visible.map((s) => {
            const isHome = s.teamId === homeTeamId;
            const x = isHome ? s.start.x : PITCH.length - s.start.x;
            const y = isHome ? toSvgY(s.start.y) : s.start.y; // away mirrored: 68 - (68 - y)
            const xg = s.xg ?? 0.05;
            const r = 0.7 + Math.sqrt(xg) * 3.2;
            const color = isHome ? 'var(--home)' : 'var(--away)';
            const label = `${playerName(s.playerId)}, ${eventMinute(s)}', ${xg.toFixed(2)} xG, ${s.success ? 'goal' : 'no goal'}`;
            const content = {
              title: `${playerName(s.playerId)} · ${eventMinute(s)}'`,
              rows: [
                { color, label: 'xG', value: xg.toFixed(2) },
                { label: 'Outcome', value: s.success ? 'Goal' : 'No goal' },
                { label: PATTERN_LABEL[s.playPattern] ?? s.playPattern, value: s.bodyPart === 'head' ? 'Header' : 'Foot' },
              ],
            };
            return (
              <g
                key={s.id}
                tabIndex={0}
                role="img"
                aria-label={label}
                className="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-[var(--text)]"
                onPointerEnter={(e) => show(e.currentTarget, content)}
                onPointerLeave={hide}
                onFocus={(e) => show(e.currentTarget, content)}
                onBlur={hide}
              >
                <circle cx={x} cy={y} r={Math.max(r, 2)} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={color}
                  fillOpacity={s.success ? 1 : 0.28}
                  stroke={s.success ? 'var(--pitch)' : color}
                  strokeWidth={s.success ? 0.45 : 0.3}
                />
              </g>
            );
          })}
        </Pitch>
        {tooltip}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {(
          [
            ['home', homeName, hs],
            ['away', awayName, as],
          ] as const
        ).map(([side, name, s]) => (
          <div key={side} className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: `var(--${side})` }} />
              {name}
            </div>
            <div className="tabular flex flex-wrap gap-x-4 gap-y-0.5 text-text-2">
              <span>
                <b className="text-text">{s.shots}</b> shots
              </span>
              <span>
                <b className="text-text">{s.goals}</b> goals
              </span>
              <span>
                <b className="text-text">{s.xg.toFixed(2)}</b> xG
              </span>
              <span>
                <b className="text-text">{s.big}</b> big chances
              </span>
            </div>
          </div>
        ))}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-text">Show shots as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Min</th>
                <th className="py-1 pr-2 font-medium">Player</th>
                <th className="py-1 pr-2 font-medium">Team</th>
                <th className="py-1 pr-2 text-right font-medium">xG</th>
                <th className="py-1 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...shots]
                .sort((a, b) => eventMinute(a) - eventMinute(b))
                .map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-1 pr-2">{eventMinute(s)}&apos;</td>
                    <td className="py-1 pr-2">{playerName(s.playerId)}</td>
                    <td className="py-1 pr-2">{s.teamId === homeTeamId ? homeName : awayName}</td>
                    <td className="py-1 pr-2 text-right">{(s.xg ?? 0).toFixed(2)}</td>
                    <td className="py-1">{s.success ? 'Goal' : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
