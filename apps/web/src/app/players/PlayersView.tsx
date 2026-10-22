'use client';

import { POSITION_LABEL, Position } from '@soccalytics/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Icon } from '../../components/icons';
import { Card, EmptyState, ErrorState, Field, LinkButton, LoadingBlock, PageHeader, TeamCrest, inputClass } from '../../components/ui';
import { fmt } from '../../lib/format';
import { q } from '../../lib/queries';
import { useRole } from '../../lib/role';

export function PlayersView() {
  const { role } = useRole();
  const [position, setPosition] = useState<Position | ''>('');
  const [teamId, setTeamId] = useState('');
  const [text, setText] = useState('');
  const deferredText = useDeferredValue(text.trim());
  const teams = useQuery(q.teams());
  const players = useQuery({ ...q.players({ position, teamId, q: deferredText }), placeholderData: keepPreviousData });
  const teamById = new Map((teams.data ?? []).map((t) => [t.id, t]));

  return (
    <>
      <PageHeader
        eyebrow="Players"
        title="Player database"
        subtitle="Per-90 profiles, ratings and benchmarks for every tracked player."
        actions={
          role === 'scout' ? (
            <LinkButton href="/scouting" variant="primary">
              <Icon.sparkle size={16} /> AI scouting search
            </LinkButton>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <Field label="Search" htmlFor="player-q">
          <input
            id="player-q"
            type="search"
            className={inputClass}
            placeholder="Name…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label="Position" htmlFor="player-pos">
          <select
            id="player-pos"
            className={inputClass}
            value={position}
            onChange={(e) => setPosition(e.target.value as Position | '')}
          >
            <option value="">All positions</option>
            {Position.options.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Team" htmlFor="player-team">
          <select id="player-team" className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Card bodyClassName="p-0">
        {players.isPending ? (
          <div className="p-5">
            <LoadingBlock rows={8} label="Loading players" />
          </div>
        ) : players.error ? (
          <ErrorState error={players.error} onRetry={() => void players.refetch()} />
        ) : !players.data.length ? (
          <EmptyState title="No players found" body="Try a different name, position or team." />
        ) : (
          <div className={clsx('overflow-x-auto transition-opacity', players.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Players</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Player
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Position
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Team
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Age
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Matches
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Minutes
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Avg rating
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {players.data.map((p) => {
                  const team = teamById.get(p.teamId);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <th scope="row" className="px-5 py-2.5 font-normal">
                        <Link href={`/players/${p.id}`} className="flex items-center gap-3 hover:underline">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-text-2">
                            {p.shirtNumber}
                          </span>
                          <span className="font-medium">{p.name}</span>
                        </Link>
                      </th>
                      <td className="px-3 py-2.5 text-text-2">{POSITION_LABEL[p.position] ?? p.position}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2 text-text-2">
                          {team && <TeamCrest team={team} size={20} />}
                          {p.teamName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-2">{Math.floor(p.age)}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{p.matches}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{fmt.int(p.minutes)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold">{fmt.rating(p.avgRating)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
