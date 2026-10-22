'use client';

import { JobStage, POSITION_LABEL, Position, type Overview, type ProcessingJob } from '@soccalytics/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../components/icons';
import { MatchRow } from '../components/match';
import {
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatTile,
} from '../components/ui';
import { fmt, jobProgress } from '../lib/format';
import { q } from '../lib/queries';
import { useRole, type Role } from '../lib/role';

const SUBTITLE: Record<Role, string> = {
  coach: 'Your latest matches, live processing and who is performing.',
  player: 'Form, ratings and benchmarks across the league.',
  scout: 'Top performers and fast routes into recruitment searches.',
};

function positionLabel(p: string) {
  const parsed = Position.safeParse(p);
  return parsed.success ? POSITION_LABEL[parsed.data] : p;
}

function ActiveJob({ job }: { job: ProcessingJob }) {
  const running = job.stages.find((s) => s.status === 'running');
  const stageIdx = running ? JobStage.options.indexOf(running.stage) + 1 : null;
  return (
    <li>
      <Link href={`/matches/${job.matchId}`} className="block rounded-lg px-3 py-3 hover:bg-surface-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-medium">
            {job.kind === 'video' ? <Icon.video size={16} /> : <Icon.dice size={16} />}
            {job.kind === 'video' ? 'Video analysis' : 'Simulation'}
          </span>
          <span className="text-xs text-muted">
            {running ? `${running.stage} · step ${stageIdx}/${JobStage.options.length}` : job.status}
          </span>
        </div>
        <ProgressBar value={jobProgress(job)} label={`Job ${job.id} progress`} />
        {running?.message && <p className="mt-1.5 truncate text-xs text-muted">{running.message}</p>}
      </Link>
    </li>
  );
}

function TopPerformers({ data }: { data: Overview['topPerformers'] }) {
  if (!data.length) return <EmptyState title="No ratings yet" body="Analyse or simulate a match to rate players." />;
  const max = Math.max(...data.map((p) => p.avgRating), 10);
  return (
    <ol className="flex flex-col">
      {data.slice(0, 8).map((p, i) => (
        <li key={p.playerId}>
          <Link
            href={`/players/${p.playerId}`}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
          >
            <span className="tabular text-center text-xs text-muted">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block truncate text-xs text-muted">
                {positionLabel(p.position)} · {p.teamName}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="hidden h-1.5 w-16 overflow-hidden rounded-r bg-surface-3 sm:block" aria-hidden="true">
                <span className="block h-full rounded-r" style={{ width: `${(p.avgRating / max) * 100}%`, background: 'var(--series-1)' }} />
              </span>
              <span className="tabular w-8 text-right text-sm font-semibold">{fmt.rating(p.avgRating)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function OverviewView() {
  const { role } = useRole();
  const query = useQuery({
    ...q.overview(),
    refetchInterval: (qq) => (qq.state.data?.activeJobs.length ? 4000 : false),
  });

  const header = (
    <PageHeader
      eyebrow="Overview"
      title="Match intelligence"
      subtitle={SUBTITLE[role]}
      actions={
        <>
          {role === 'scout' && (
            <LinkButton href="/scouting" variant="primary">
              <Icon.scouting size={16} /> Start a scouting search
            </LinkButton>
          )}
          <LinkButton href="/analyse" variant={role === 'scout' ? 'secondary' : 'primary'}>
            <Icon.analyse size={16} /> Analyse a match
          </LinkButton>
          <LinkButton href="/analyse?mode=simulate" variant="secondary">
            <Icon.dice size={16} /> Simulate a match
          </LinkButton>
        </>
      }
    />
  );

  if (query.isPending)
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </>
    );

  if (query.error || !query.data)
    return (
      <>
        {header}
        <div className="card">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </>
    );

  const d = query.data;
  const sections: Record<string, ReactNode> = {
    matches: (
      <Card
        key="matches"
        title="Recent matches"
        subtitle="Score and expected goals"
        actions={
          <Link href="/matches" className="text-xs font-medium text-accent hover:underline">
            All matches
          </Link>
        }
        bodyClassName="px-2 pb-3"
      >
        {d.recentMatches.length ? (
          <div className="flex flex-col">
            {d.recentMatches.slice(0, 6).map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matches yet"
            body="Upload a video or run a simulation to see your first analysis."
            action={
              <LinkButton href="/analyse" variant="primary" size="sm">
                Analyse a match
              </LinkButton>
            }
          />
        )}
      </Card>
    ),
    performers: (
      <Card key="performers" title="Top performers" subtitle="Average match rating" bodyClassName="px-3 pb-3">
        <TopPerformers data={d.topPerformers} />
      </Card>
    ),
  };
  const order = role === 'coach' ? ['matches', 'performers'] : ['performers', 'matches'];

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Teams" value={fmt.int(d.teams)} icon={<Icon.shield size={16} />} />
        <StatTile label="Players" value={fmt.int(d.players)} icon={<Icon.players size={16} />} />
        <StatTile label="Matches analysed" value={fmt.int(d.matchesAnalysed)} icon={<Icon.matches size={16} />} />
        <StatTile
          label="Events detected"
          value={fmt.compact(d.eventsDetected)}
          hint="Inferred automatically from tracking"
          icon={<Icon.bolt size={16} />}
        />
      </div>

      {d.activeJobs.length > 0 && (
        <Card
          className="mt-4"
          title={
            <span className="flex items-center gap-2">
              <span className="pulse-dot h-2 w-2 rounded-full bg-accent" /> Processing now
            </span>
          }
          subtitle={`${d.activeJobs.length} active job${d.activeJobs.length > 1 ? 's' : ''}`}
          bodyClassName="px-2 pb-2"
        >
          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {d.activeJobs.map((j) => (
              <ActiveJob key={j.id} job={j} />
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className={order[0] === 'matches' ? 'lg:col-span-3' : 'lg:col-span-2'}>{sections[order[0]]}</div>
        <div className={order[1] === 'matches' ? 'lg:col-span-3' : 'lg:col-span-2'}>{sections[order[1]]}</div>
      </div>
    </>
  );
}
