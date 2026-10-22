'use client';

import { METRIC_META, POSITION_LABEL, type ScoutFilter } from '@soccalytics/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../components/icons';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { fmt } from '../../lib/format';
import { q } from '../../lib/queries';

function examplePrompts(starName: string | null) {
  return [
    'Left-footed full-backs under 21 who progress the ball and press hard',
    `A striker similar to ${starName ?? 'our top scorer'} with high xG per 90`,
    'Ball-playing centre-backs with elite pass accuracy and interceptions',
    'Wingers who beat their man and create xT, any age',
  ];
}

function Chip({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs">
      {icon && <span className="text-muted">{icon}</span>}
      <span className="text-muted">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </li>
  );
}

function CompiledFilter({ filter }: { filter: ScoutFilter }) {
  const age =
    filter.minAge !== null && filter.maxAge !== null
      ? `${filter.minAge}–${filter.maxAge}`
      : filter.maxAge !== null
        ? `≤ ${filter.maxAge}`
        : filter.minAge !== null
          ? `≥ ${filter.minAge}`
          : null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon.sparkle size={16} className="text-accent" /> How the AI read your query
        </span>
      }
      subtitle="Natural language compiled into a structured, auditable filter"
    >
      <p className="mb-4 rounded-lg border-l-2 border-accent bg-accent-soft px-3 py-2 text-sm italic">“{filter.interpretation}”</p>
      <ul className="flex flex-wrap gap-2" aria-label="Compiled filter">
        <Chip
          label="Positions"
          value={filter.positions.length ? filter.positions.map((p) => POSITION_LABEL[p]).join(', ') : 'Any'}
        />
        {age && <Chip label="Age" value={age} />}
        {filter.foot && <Chip label="Foot" value={filter.foot} />}
        {filter.minMinutes !== null && <Chip label="Min. minutes" value={fmt.int(filter.minMinutes)} />}
        {filter.similarToPlayerName && <Chip label="Similar to" value={filter.similarToPlayerName} icon={<Icon.players size={12} />} />}
        {filter.metricThresholds.map((t) => (
          <Chip key={t.metric} label={METRIC_META[t.metric]?.label ?? t.metric} value={`≥ ${fmt.ordinal(t.minPercentile)} pct`} />
        ))}
        {filter.rankBy.length > 0 && (
          <Chip
            label="Rank by"
            icon={<Icon.arrowDown size={12} />}
            value={filter.rankBy.map((m) => METRIC_META[m]?.label ?? m).join(' → ')}
          />
        )}
      </ul>
    </Card>
  );
}

export function ScoutingView() {
  const [text, setText] = useState('');
  const top = useQuery({ ...q.overview(), retry: false });
  const star = top.data?.topPerformers.find((p) => p.position === 'ST') ?? top.data?.topPerformers[0];
  const search = useMutation({ mutationFn: (query: string) => api.scoutSearch(query, 20) });

  const run = (value: string) => {
    const v = value.trim();
    if (v.length < 3) return;
    setText(v);
    search.mutate(v);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(text);
  };

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title="Ask for the player you need"
        subtitle="Describe a profile in plain English. Claude compiles it into a filter; the analytics engine ranks real per-90 percentiles."
      />

      <form onSubmit={onSubmit} className="card p-3 sm:p-4" role="search">
        <label htmlFor="scout-q" className="sr-only">
          Describe the player you are looking for
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Icon.scouting size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="scout-q"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Left-footed full-backs under 21 who progress the ball and press hard"
              maxLength={500}
              className="h-12 w-full rounded-lg border border-border-strong bg-surface-2 pl-10 pr-3 text-[15px] placeholder:text-muted"
            />
          </div>
          <Button type="submit" variant="primary" className="h-12 px-5" loading={search.isPending} disabled={text.trim().length < 3}>
            <Icon.sparkle size={16} /> Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {examplePrompts(star?.name ?? null).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => run(p)}
              className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-text-2 hover:border-border-strong hover:text-text"
            >
              {p}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-4">
        {search.isPending && (
          <>
            <Skeleton className="h-36" />
            <Skeleton className="h-80" />
          </>
        )}
        {search.error && (
          <div className="card">
            <ErrorState error={search.error} onRetry={() => run(text)} />
          </div>
        )}
        {search.isIdle && (
          <div className="card">
            <EmptyState
              icon={<Icon.sparkle />}
              title="Start with a description"
              body="Mention positions, age, foot, style (progressive, pressing, creative) or a reference player."
            />
          </div>
        )}
        {search.data && (
          <>
            <CompiledFilter filter={search.data.filter} />
            <Card title="Results" subtitle={`${search.data.results.length} players ranked by match score`} bodyClassName="p-0">
              {search.data.results.length === 0 ? (
                <EmptyState title="No players match every constraint" body="Try relaxing the age or percentile thresholds." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <caption className="sr-only">Scouting results</caption>
                    <thead>
                      <tr className="border-b border-border text-xs text-muted">
                        <th scope="col" className="px-5 py-3 font-medium">
                          #
                        </th>
                        <th scope="col" className="px-3 py-3 font-medium">
                          Player
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">
                          Age
                        </th>
                        <th scope="col" className="px-3 py-3 text-right font-medium">
                          Minutes
                        </th>
                        <th scope="col" className="px-3 py-3 font-medium">
                          Highlights (per 90 · percentile)
                        </th>
                        <th scope="col" className="px-5 py-3 text-right font-medium">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {search.data.results.map((r, i) => {
                        const maxScore = Math.max(...search.data.results.map((x) => x.score), 1e-9);
                        return (
                          <tr key={r.playerId} className="border-b border-border align-top last:border-0 hover:bg-surface-2">
                            <td className="px-5 py-3 text-muted">{i + 1}</td>
                            <th scope="row" className="px-3 py-3 font-normal">
                              <Link href={`/players/${r.playerId}`} className="font-medium hover:underline">
                                {r.name}
                              </Link>
                              <div className="text-xs text-muted">
                                {POSITION_LABEL[r.position]} · {r.teamName}
                              </div>
                            </th>
                            <td className="px-3 py-3 text-right text-text-2">{Math.floor(r.age)}</td>
                            <td className="px-3 py-3 text-right text-text-2">{fmt.int(r.minutes)}</td>
                            <td className="px-3 py-3">
                              <ul className="flex flex-col gap-1.5">
                                {r.highlights.slice(0, 3).map((h) => (
                                  <li key={h.metric} className="grid grid-cols-[minmax(0,9rem)_3.5rem_1fr_2rem] items-center gap-2 text-xs">
                                    <span className="truncate text-text-2">{METRIC_META[h.metric]?.label ?? h.metric}</span>
                                    <span className="text-right">{h.per90.toFixed(2)}</span>
                                    <span className="h-1.5 overflow-hidden rounded-r bg-surface-3" aria-hidden="true">
                                      <span
                                        className="block h-full rounded-r"
                                        style={{ width: `${Math.max(0, Math.min(100, h.percentile))}%`, background: 'var(--series-1)' }}
                                      />
                                    </span>
                                    <span className="text-right font-medium">{Math.round(h.percentile)}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="font-semibold">{r.score.toFixed(r.score < 10 ? 2 : 0)}</div>
                              <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-r bg-surface-3" aria-hidden="true">
                                <div className="h-full rounded-r" style={{ width: `${(r.score / maxScore) * 100}%`, background: 'var(--series-1)' }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
