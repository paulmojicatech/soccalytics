'use client';

import {
  METRIC_META,
  POSITION_LABEL,
  type BenchmarkCohort,
  type MetricGroup,
  type PlayerDetail,
  type PlayerEvaluation,
  type PlayerMetricKey,
} from '@soccalytics/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ClaimList, GroundingBadge, ProvenanceFooter, type SubjectResolver } from '../../../components/ai';
import { PercentileBars } from '../../../components/charts/PercentileBars';
import { RatingTrend } from '../../../components/charts/RatingTrend';
import { Icon } from '../../../components/icons';
import { GeneratingState, useElapsed } from '../../../components/MatchReportPanel';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingBlock,
  QueryState,
  Skeleton,
  StatTile,
  Tabs,
  TeamCrest,
} from '../../../components/ui';
import { api, isNotFound } from '../../../lib/api';
import { fmt, formatMetric } from '../../../lib/format';
import { q } from '../../../lib/queries';
import { useRole } from '../../../lib/role';

const COHORTS: { id: BenchmarkCohort; label: string }[] = [
  { id: 'position_peers', label: 'Position peers' },
  { id: 'team', label: 'Team' },
  { id: 'pro_reference', label: 'Pro reference' },
];

const VERDICT: Record<PlayerEvaluation['scoutingVerdict'], { label: string; tone: 'accent' | 'good' | 'neutral' | 'critical'; icon: ReactNode }> = {
  priority_target: { label: 'Priority target', tone: 'accent', icon: <Icon.target size={14} /> },
  shortlist: { label: 'Shortlist', tone: 'good', icon: <Icon.check size={14} /> },
  monitor: { label: 'Monitor', tone: 'neutral', icon: <Icon.scouting size={14} /> },
  not_a_fit: { label: 'Not a fit', tone: 'critical', icon: <Icon.x size={14} /> },
};

const GROUPS: { id: MetricGroup; label: string }[] = [
  { id: 'possession', label: 'In possession' },
  { id: 'shooting', label: 'Shooting' },
  { id: 'defending', label: 'Defending' },
  { id: 'physical', label: 'Physical' },
];

function Header({ d }: { d: PlayerDetail }) {
  const p = d.player;
  const facts: [string, ReactNode][] = [
    ['Age', Math.floor(d.age)],
    ['Foot', p.foot === 'both' ? 'Both' : p.foot === 'left' ? 'Left' : 'Right'],
    ['Height', p.heightCm ? `${p.heightCm} cm` : '–'],
    ['Nationality', p.nationality ?? '–'],
  ];
  return (
    <section aria-label="Player" className="card relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ background: d.team.primaryColor }} />
      <div className="flex flex-col gap-5 p-5 pt-6 sm:flex-row sm:items-center sm:p-6">
        <div
          className="tabular grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-3xl font-bold"
          style={{ background: d.team.primaryColor, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.5)' }}
          aria-label={`Shirt number ${p.shirtNumber}`}
        >
          {p.shirtNumber}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{POSITION_LABEL[p.position]}</Badge>
            <span className="flex items-center gap-1.5 text-sm text-text-2">
              <TeamCrest team={d.team} size={20} /> {d.team.name}
            </span>
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{p.name}</h1>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Per90({ d }: { d: PlayerDetail }) {
  if (!d.profile) return <EmptyState title="No minutes recorded yet" />;
  const per90 = d.profile.per90;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      {GROUPS.map((g) => {
        const keys = (Object.keys(METRIC_META) as PlayerMetricKey[]).filter(
          (k) => METRIC_META[k].group === g.id && per90[k] !== undefined,
        );
        if (!keys.length) return null;
        return (
          <table key={g.id} className="w-full text-sm">
            <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wider text-muted">{g.label}</caption>
            <tbody className="tabular">
              {keys.map((k) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-text-2">
                    {METRIC_META[k].label}
                  </th>
                  <td className="py-1.5 text-right font-medium">{formatMetric(k, per90[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

function RecentMatches({ d }: { d: PlayerDetail }) {
  if (!d.recentMatches.length) return <EmptyState title="No recent matches" />;
  return (
    <ul className="flex flex-col">
      {[...d.recentMatches]
        .sort((a, b) => b.match.kickoffAt.localeCompare(a.match.kickoffAt))
        .slice(0, 8)
        .map((r) => {
          const m = r.match;
          const isHome = m.homeTeamId === d.player.teamId;
          const opp = isHome ? m.awayTeam : m.homeTeam;
          const gf = isHome ? m.homeScore : m.awayScore;
          const ga = isHome ? m.awayScore : m.homeScore;
          const result = gf === null || ga === null ? null : gf > ga ? 'W' : gf < ga ? 'L' : 'D';
          return (
            <li key={r.matchId}>
              <Link
                href={`/matches/${r.matchId}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <span
                  className={clsx(
                    'grid h-6 w-6 place-items-center rounded text-[11px] font-bold',
                    result === 'W' && 'bg-good-soft text-good-text',
                    result === 'L' && 'bg-critical-soft text-critical-text',
                    (result === 'D' || !result) && 'bg-surface-3 text-text-2',
                  )}
                  aria-label={result === 'W' ? 'Win' : result === 'L' ? 'Loss' : result === 'D' ? 'Draw' : 'No result'}
                >
                  {result ?? '–'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {isHome ? 'vs' : '@'} {opp.name}{' '}
                    {gf !== null && ga !== null && (
                      <span className="tabular text-muted">
                        {gf}–{ga}
                      </span>
                    )}
                  </span>
                  <span className="tabular block text-xs text-muted">
                    {fmt.shortDate(m.kickoffAt)} · {Math.round(r.metrics.minutes ?? 0)}′ · {r.metrics.goals ?? 0} G ·{' '}
                    {(r.metrics.xg ?? 0).toFixed(2)} xG
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">{r.rating.toFixed(1)}</span>
              </Link>
            </li>
          );
        })}
    </ul>
  );
}

function SimilarPlayers({ id }: { id: string }) {
  const query = useQuery(q.playerSimilar(id));
  return (
    <QueryState query={query} compact loading={<LoadingBlock rows={4} />}>
      {(list) =>
        list.length ? (
          <ul className="flex flex-col">
            {list.slice(0, 6).map((s) => (
              <li key={s.playerId}>
                <Link
                  href={`/players/${s.playerId}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {POSITION_LABEL[s.position]} · {s.teamName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="hidden h-1.5 w-14 overflow-hidden rounded-r bg-surface-3 sm:block" aria-hidden="true">
                      <span
                        className="block h-full rounded-r"
                        style={{ width: `${Math.max(0, Math.min(1, s.similarity)) * 100}%`, background: 'var(--series-1)' }}
                      />
                    </span>
                    <span className="tabular w-10 text-right text-sm font-semibold">{Math.round(s.similarity * 100)}%</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No comparable players yet" />
        )
      }
    </QueryState>
  );
}

function Benchmarks({ id }: { id: string }) {
  const [cohort, setCohort] = useState<BenchmarkCohort>('position_peers');
  const query = useQuery({ ...q.playerBenchmark(id, cohort), placeholderData: keepPreviousData });
  return (
    <Card
      title="Benchmarks"
      subtitle={
        query.data
          ? `Per-90 percentile vs ${query.data.cohortSize} players · tick marks the cohort median`
          : 'Per-90 percentile vs cohort'
      }
      actions={<Tabs size="sm" label="Benchmark cohort" tabs={COHORTS} value={cohort} onChange={setCohort} />}
    >
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-text-2">
        <span className="inline-flex items-center gap-1 text-good-text">
          <Icon.arrowUp size={12} /> Strength
        </span>
        <span className="inline-flex items-center gap-1 text-critical-text">
          <Icon.arrowDown size={12} /> Development area
        </span>
      </div>
      <div className={clsx('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
        <QueryState query={query} loading={<LoadingBlock rows={8} />}>
          {(b) => (b.metrics.length ? <PercentileBars benchmark={b} /> : <EmptyState title="Not enough data to benchmark" />)}
        </QueryState>
      </div>
    </Card>
  );
}

function Evaluation({ id, resolve }: { id: string; resolve: SubjectResolver }) {
  const qc = useQueryClient();
  const query = useQuery(q.playerEvaluation(id));
  const gen = useMutation({
    mutationFn: () => api.generatePlayerEvaluation(id),
    onSuccess: (data) => qc.setQueryData(q.playerEvaluation(id).queryKey, data),
  });
  const elapsed = useElapsed(gen.isPending);
  const ev = query.data?.evaluation;
  const verdict = ev ? VERDICT[ev.scoutingVerdict] : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon.sparkle size={16} className="text-accent" /> AI evaluation
        </span>
      }
      subtitle="Claude's read of the computed profile — every claim is evidence-checked"
      actions={
        query.data && !gen.isPending ? (
          <Button size="sm" variant="ghost" onClick={() => gen.mutate()}>
            <Icon.refresh size={14} /> Regenerate
          </Button>
        ) : undefined
      }
    >
      {gen.error && <ErrorState error={gen.error} compact onRetry={() => gen.mutate()} />}
      {gen.isPending ? (
        <GeneratingState what="the player evaluation" elapsed={elapsed} />
      ) : query.isPending ? (
        <LoadingBlock rows={4} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : !query.data || !ev ? (
        <EmptyState
          icon={<Icon.sparkle />}
          title="No evaluation yet"
          body="Generate a grounded scouting evaluation with strengths, development areas and a plan."
          action={
            <Button variant="primary" onClick={() => gen.mutate()}>
              <Icon.sparkle size={16} /> Generate evaluation
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            {verdict && (
              <Badge tone={verdict.tone} className="px-2.5 py-1 text-sm">
                {verdict.icon} Verdict: {verdict.label}
              </Badge>
            )}
            <GroundingBadge grounding={query.data.meta.grounding} />
          </div>
          <p className="max-w-3xl leading-relaxed text-text-2">{ev.summary}</p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-good-text">
                <Icon.arrowUp size={14} /> Strengths
              </h3>
              <ClaimList claims={ev.strengths} resolve={resolve} />
            </section>
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-critical-text">
                <Icon.arrowDown size={14} /> Development areas
              </h3>
              <ClaimList claims={ev.developmentAreas} resolve={resolve} />
            </section>
          </div>
          {ev.playerComparison && (
            <section className="rounded-xl border border-border bg-surface-2 p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Stylistic comparison</h3>
              <p className="text-sm leading-relaxed">{ev.playerComparison}</p>
            </section>
          )}
          {ev.developmentPlan.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Development plan</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Goal
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        KPI
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Timeframe
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ev.developmentPlan.map((g, i) => (
                      <tr key={i} className="border-b border-border last:border-0 align-top">
                        <td className="py-2 pr-3 font-medium">{g.goal}</td>
                        <td className="py-2 pr-3 text-text-2">{g.kpi}</td>
                        <td className="tabular py-2 text-right text-text-2">{g.timeframeWeeks} wks</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <ProvenanceFooter meta={query.data.meta} />
        </div>
      )}
    </Card>
  );
}

export function PlayerProfileView({ id }: { id: string }) {
  const { role } = useRole();
  const query = useQuery(q.player(id));
  const trend = useQuery(q.playerTrend(id));

  if (query.isPending)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );

  if (query.error || !query.data)
    return (
      <div className="card">
        {isNotFound(query.error) ? (
          <EmptyState
            title="Player not found"
            action={
              <LinkButton href="/players" size="sm">
                Back to players
              </LinkButton>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );

  const d = query.data;
  const resolve: SubjectResolver = (sid) =>
    sid === d.player.id ? { label: d.player.name.split(' ').slice(-1)[0] } : sid === d.team.id ? { label: d.team.shortName } : undefined;
  const per90 = d.profile?.per90;
  const evaluation = <Evaluation key="eval" id={id} resolve={resolve} />;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <Link href="/players" className="hover:text-text">
          Players
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-text-2">{d.player.name}</span>
      </nav>

      <Header d={d} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Average rating" value={fmt.rating(d.profile?.avgRating)} hint="0–10 composite" />
        <StatTile label="Matches" value={d.profile?.matches ?? 0} hint={`${fmt.int(d.profile?.minutes ?? 0)} minutes`} />
        <StatTile
          label="xG + xA per 90"
          value={per90 ? ((per90.xg ?? 0) + (per90.xa ?? 0)).toFixed(2) : '–'}
          hint={per90 ? `${(per90.xg ?? 0).toFixed(2)} xG · ${(per90.xa ?? 0).toFixed(2)} xA` : undefined}
        />
        <StatTile
          label="Progressive actions per 90"
          value={per90 ? ((per90.progressive_passes ?? 0) + (per90.progressive_carries ?? 0)).toFixed(1) : '–'}
          hint="Passes + carries"
        />
      </div>

      {role === 'scout' && evaluation}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Form & projection" subtitle="Match ratings with projected range">
          <QueryState query={trend} loading={<Skeleton className="h-64" />} compact>
            {(t) => <RatingTrend trend={t} />}
          </QueryState>
        </Card>
        <Card title="Similar players" subtitle="Cosine similarity of per-90 profile" bodyClassName="px-3 pb-3">
          <SimilarPlayers id={id} />
        </Card>
      </div>

      <Benchmarks id={id} />

      {role !== 'scout' && evaluation}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Per-90 profile" subtitle={d.profile ? `${d.profile.matches} matches` : undefined}>
          <Per90 d={d} />
        </Card>
        <Card className="lg:col-span-2" title="Recent matches" bodyClassName="px-3 pb-3">
          <RecentMatches d={d} />
        </Card>
      </div>
    </div>
  );
}
