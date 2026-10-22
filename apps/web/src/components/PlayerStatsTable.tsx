'use client';

import type { PlayerMatchStats, PlayerMetricKey } from '@soccalytics/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { asPct } from '../lib/format';
import { Icon } from './icons';
import { Tabs } from './ui';

interface PlayerInfo {
  name: string;
  shirtNumber: number | null;
}

type ColKey = 'name' | 'rating' | PlayerMetricKey;

const COLS: { key: ColKey; label: string; title?: string; format?: (n: number) => string }[] = [
  { key: 'name', label: 'Player' },
  { key: 'minutes', label: 'Min' },
  { key: 'rating', label: 'Rating', format: (n) => n.toFixed(1) },
  { key: 'goals', label: 'G', title: 'Goals' },
  { key: 'xg', label: 'xG', title: 'Expected goals', format: (n) => n.toFixed(2) },
  { key: 'xa', label: 'xA', title: 'Expected assists', format: (n) => n.toFixed(2) },
  { key: 'shots', label: 'Sh', title: 'Shots' },
  { key: 'passes', label: 'Pass', title: 'Passes' },
  { key: 'pass_accuracy', label: 'Pass %', title: 'Pass accuracy', format: (n) => asPct(n).toFixed(0) },
  { key: 'progressive_passes', label: 'Prog P', title: 'Progressive passes' },
  { key: 'key_passes', label: 'KP', title: 'Key passes' },
  { key: 'xt_added', label: 'xT', title: 'Expected threat added', format: (n) => n.toFixed(2) },
  { key: 'pressures', label: 'Press', title: 'Pressures' },
  { key: 'tackles_won', label: 'Tkl', title: 'Tackles won' },
  { key: 'interceptions', label: 'Int', title: 'Interceptions' },
  { key: 'distance_km', label: 'Dist', title: 'Distance (km)', format: (n) => n.toFixed(1) },
  { key: 'top_speed_kmh', label: 'Top spd', title: 'Top speed (km/h)', format: (n) => n.toFixed(1) },
];

export function PlayerStatsTable({
  stats,
  player,
  homeTeamId,
  homeName,
  awayName,
}: {
  stats: PlayerMatchStats[];
  player: (id: string) => PlayerInfo;
  homeTeamId: string;
  homeName: string;
  awayName: string;
}) {
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' }>({ key: 'rating', dir: 'desc' });
  const [team, setTeam] = useState<'all' | 'home' | 'away'>('all');

  const rows = useMemo(() => {
    const value = (s: PlayerMatchStats, k: ColKey): number | string =>
      k === 'name' ? player(s.playerId).name : k === 'rating' ? s.rating : (s.metrics[k] ?? 0);
    return stats
      .filter((s) => team === 'all' || (team === 'home') === (s.teamId === homeTeamId))
      .sort((a, b) => {
        const va = value(a, sort.key);
        const vb = value(b, sort.key);
        const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
        return sort.dir === 'asc' ? cmp : -cmp;
      });
  }, [stats, sort, team, homeTeamId, player]);

  const maxRating = Math.max(10, ...stats.map((s) => s.rating));

  const toggle = (key: ColKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  return (
    <div>
      <div className="mb-3">
        <Tabs
          size="sm"
          label="Filter players by team"
          value={team}
          onChange={setTeam}
          tabs={[
            { id: 'all', label: 'Both teams' },
            { id: 'home', label: homeName },
            { id: 'away', label: awayName },
          ]}
        />
      </div>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[960px] text-left text-sm">
          <caption className="sr-only">Player match statistics, sortable by column</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              {COLS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={clsx('py-2 font-medium', c.key === 'name' ? 'sticky left-0 bg-surface pr-3' : 'px-2 text-right')}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      title={c.title}
                      className={clsx(
                        'inline-flex items-center gap-0.5 rounded hover:text-text',
                        active && 'text-text',
                        c.key !== 'name' && 'flex-row-reverse',
                      )}
                    >
                      {c.label}
                      <span className={clsx('w-3', !active && 'opacity-0')} aria-hidden="true">
                        {sort.dir === 'asc' ? <Icon.arrowUp size={12} /> : <Icon.arrowDown size={12} />}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((s) => {
              const info = player(s.playerId);
              const isHome = s.teamId === homeTeamId;
              return (
                <tr key={s.playerId} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <th scope="row" className="sticky left-0 bg-surface py-2 pr-3 font-normal">
                    <Link href={`/players/${s.playerId}`} className="flex items-center gap-2 hover:underline">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: isHome ? 'var(--home)' : 'var(--away)' }}
                      />
                      <span className="w-6 text-right text-xs text-muted">{info.shirtNumber ?? ''}</span>
                      <span className="truncate font-medium">{info.name}</span>
                      <span className="text-xs text-muted">{s.position}</span>
                    </Link>
                  </th>
                  {COLS.slice(1).map((c) => {
                    if (c.key === 'rating')
                      return (
                        <td key={c.key} className="px-2 py-2 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-1.5 w-10 overflow-hidden rounded-r bg-surface-3" aria-hidden="true">
                              <span
                                className="block h-full rounded-r"
                                style={{ width: `${(s.rating / maxRating) * 100}%`, background: 'var(--series-1)' }}
                              />
                            </span>
                            <b className="w-7">{s.rating.toFixed(1)}</b>
                          </span>
                        </td>
                      );
                    const v = c.key === 'name' ? 0 : (s.metrics[c.key] ?? 0);
                    return (
                      <td key={c.key} className="px-2 py-2 text-right text-text-2">
                        {c.format ? c.format(v) : Math.round(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
