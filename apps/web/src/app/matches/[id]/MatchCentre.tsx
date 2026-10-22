'use client';

import type { MatchDetail } from '@soccalytics/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { SubjectResolver } from '../../../components/ai';
import { PassingNetwork } from '../../../components/charts/PassingNetwork';
import { ShotMap, eventMinute } from '../../../components/charts/ShotMap';
import { TeamComparison } from '../../../components/charts/TeamComparison';
import { XgRace, type GoalMark } from '../../../components/charts/XgRace';
import { Icon } from '../../../components/icons';
import { LiveJob } from '../../../components/JobPipeline';
import { MatchStatusBadge, SourceBadge } from '../../../components/match';
import { MatchReportPanel } from '../../../components/MatchReportPanel';
import { PlayerStatsTable } from '../../../components/PlayerStatsTable';
import {
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingBlock,
  Skeleton,
  TabPanel,
  Tabs,
  TeamCrest,
} from '../../../components/ui';
import { isNotFound } from '../../../lib/api';
import { fmt } from '../../../lib/format';
import { q } from '../../../lib/queries';

type TabId = 'overview' | 'xg' | 'shots' | 'network' | 'players' | 'report';

function Scoreboard({ d }: { d: MatchDetail }) {
  const m = d.match;
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  const homeStats = d.teamStats.find((t) => t.teamId === m.homeTeamId);
  const awayStats = d.teamStats.find((t) => t.teamId === m.awayTeamId);
  const homeXg = m.homeXg ?? homeStats?.xg ?? null;
  const awayXg = m.awayXg ?? awayStats?.xg ?? null;
  return (
    <section aria-label="Scoreline" className="card relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5"
        style={{
          background: `linear-gradient(90deg, ${m.homeTeam.primaryColor} 0 50%, ${m.awayTeam.primaryColor} 50% 100%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          background: `radial-gradient(60% 120% at 0% 50%, ${m.homeTeam.primaryColor}, transparent 70%), radial-gradient(60% 120% at 100% 50%, ${m.awayTeam.primaryColor}, transparent 70%)`,
        }}
      />
      <div className="relative px-4 pb-5 pt-6 sm:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
          <span className="font-medium text-text-2">{m.competition}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={m.kickoffAt}>{fmt.dateTime(m.kickoffAt)}</time>
          {m.venue && (
            <>
              <span aria-hidden="true">·</span>
              <span>{m.venue}</span>
            </>
          )}
          <SourceBadge source={m.source} />
          <MatchStatusBadge status={m.status} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row-reverse sm:justify-start sm:text-right">
            <TeamCrest team={m.homeTeam} size={56} />
            <div className="w-full min-w-0 sm:w-auto">
              <h1 className="truncate text-base font-semibold sm:text-2xl">
                <span className="sm:hidden">{m.homeTeam.shortName}</span>
                <span className="hidden sm:inline">{m.homeTeam.name}</span>
              </h1>
              <p className="text-xs text-muted">Home</p>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div className="tabular text-4xl font-bold tracking-tight sm:text-6xl">
              {hasScore ? (
                <>
                  {m.homeScore}
                  <span className="mx-2 text-muted sm:mx-3">–</span>
                  {m.awayScore}
                </>
              ) : (
                <span className="text-2xl text-muted">vs</span>
              )}
            </div>
            {homeXg !== null && awayXg !== null && (
              <div className="tabular mt-1 flex items-center gap-2 text-sm text-text-2">
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--home)' }} aria-hidden="true" />
                {homeXg.toFixed(2)}
                <span className="text-xs text-muted">xG</span>
                {awayXg.toFixed(2)}
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--away)' }} aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-start sm:text-left">
            <TeamCrest team={m.awayTeam} size={56} />
            <div className="w-full min-w-0 sm:w-auto">
              <h2 className="truncate text-base font-semibold sm:text-2xl">
                <span className="sm:hidden">{m.awayTeam.shortName}</span>
                <span className="hidden sm:inline">{m.awayTeam.name}</span>
              </h2>
              <p className="text-xs text-muted">Away</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotAnalysed({ processing }: { processing: boolean }) {
  return (
    <EmptyState
      title={processing ? 'Analysis in progress' : 'No analysis yet'}
      body={
        processing
          ? 'Stats, shot maps and passing networks appear here as soon as the pipeline finishes.'
          : 'This match has not been processed.'
      }
    />
  );
}

const TAB_IDS: TabId[] = ['overview', 'xg', 'shots', 'network', 'players', 'report'];

export function MatchCentre({ id, initialTab }: { id: string; initialTab?: string }) {
  const [tab, setTabState] = useState<TabId>(
    TAB_IDS.includes(initialTab as TabId) ? (initialTab as TabId) : 'overview',
  );
  const setTab = useCallback((t: TabId) => {
    setTabState(t);
    try {
      const url = new URL(window.location.href);
      if (t === 'overview') url.searchParams.delete('tab');
      else url.searchParams.set('tab', t);
      window.history.replaceState(null, '', url);
    } catch {
      // ignore
    }
  }, []);
  const query = useQuery({
    ...q.match(id),
    refetchInterval: (qq) => (qq.state.data?.match.status === 'processing' ? 8000 : false),
  });
  const d = query.data;
  const analysed = !!d && d.teamStats.length > 0;
  const needShots = analysed && (tab === 'shots' || tab === 'xg');
  const shotsQuery = useQuery({ ...q.matchEvents(id, ['shot']), enabled: needShots });

  const lineupById = useMemo(() => new Map((d?.lineups ?? []).map((l) => [l.playerId, l])), [d]);
  const player = useCallback(
    (pid: string) => {
      const l = lineupById.get(pid);
      return { name: l?.player.name ?? 'Unknown player', shirtNumber: l?.player.shirtNumber ?? null };
    },
    [lineupById],
  );
  const playerName = useCallback((pid: string) => player(pid).name, [player]);
  const resolve: SubjectResolver = useCallback(
    (sid: string) => {
      if (!d) return undefined;
      if (sid === d.match.homeTeamId) return { label: d.match.homeTeam.shortName };
      if (sid === d.match.awayTeamId) return { label: d.match.awayTeam.shortName };
      const l = lineupById.get(sid);
      return l ? { label: l.player.name, href: `/players/${sid}` } : undefined;
    },
    [d, lineupById],
  );

  if (query.isPending)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-96" />
      </div>
    );

  if (query.error || !d)
    return (
      <div className="card">
        {isNotFound(query.error) ? (
          <EmptyState
            title="Match not found"
            body="It may have been removed, or the id is wrong."
            action={
              <LinkButton href="/matches" size="sm">
                Back to matches
              </LinkButton>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );

  const m = d.match;
  const home = d.teamStats.find((t) => t.teamId === m.homeTeamId);
  const away = d.teamStats.find((t) => t.teamId === m.awayTeamId);
  const job = d.latestJob;
  const jobActive = !!job && (job.status === 'running' || job.status === 'queued');
  const goals: GoalMark[] = (shotsQuery.data ?? [])
    .filter((s) => s.success)
    .map((s) => ({
      side: s.teamId === m.homeTeamId ? 'home' : 'away',
      minute: eventMinute(s),
      label: `Goal ${playerName(s.playerId)} ${eventMinute(s)}'`,
    }));

  const tabs: { id: TabId; label: ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'xg', label: 'xG race' },
    { id: 'shots', label: 'Shot map' },
    { id: 'network', label: 'Passing network' },
    { id: 'players', label: 'Player stats' },
    {
      id: 'report',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Icon.sparkle size={14} /> AI report
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <Link href="/matches" className="hover:text-text">
          Matches
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-text-2">
          {m.homeTeam.shortName} v {m.awayTeam.shortName}
        </span>
      </nav>

      <Scoreboard d={d} />

      {(jobActive || m.status === 'processing' || job?.status === 'failed') && job && (
        <Card title="Processing pipeline" subtitle="Live updates from the analysis workers">
          <LiveJob jobId={job.id} initial={job} />
        </Card>
      )}

      <Tabs label="Match views" tabs={tabs} value={tab} onChange={setTab} />

      <TabPanel id={tab}>
        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3" title="Team comparison" subtitle="Leading value in bold">
              {home && away ? (
                <TeamComparison home={home} away={away} homeName={m.homeTeam.name} awayName={m.awayTeam.name} />
              ) : (
                <NotAnalysed processing={m.status === 'processing'} />
              )}
            </Card>
            <div className="flex flex-col gap-4 lg:col-span-2">
              <Card title="xG race" subtitle="Cumulative expected goals">
                {home && away ? (
                  <XgRace home={home} away={away} homeName={m.homeTeam.shortName} awayName={m.awayTeam.shortName} />
                ) : (
                  <NotAnalysed processing={m.status === 'processing'} />
                )}
              </Card>
              {analysed && (
                <Card title="Best rated" subtitle="Top match ratings" bodyClassName="px-3 pb-3">
                  <ol>
                    {[...d.playerStats]
                      .sort((a, b) => b.rating - a.rating)
                      .slice(0, 5)
                      .map((s) => (
                        <li key={s.playerId}>
                          <Link
                            href={`/players/${s.playerId}`}
                            className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full"
                              style={{ background: s.teamId === m.homeTeamId ? 'var(--home)' : 'var(--away)' }}
                            />
                            <span className="flex-1 truncate text-sm">{playerName(s.playerId)}</span>
                            <span className="text-xs text-muted">{s.position}</span>
                            <span className="tabular w-8 text-right text-sm font-semibold">{s.rating.toFixed(1)}</span>
                          </Link>
                        </li>
                      ))}
                  </ol>
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === 'xg' && (
          <Card title="xG race" subtitle="Cumulative expected goals by minute; dots mark goals">
            {home && away ? (
              <XgRace home={home} away={away} homeName={m.homeTeam.name} awayName={m.awayTeam.name} goals={goals} />
            ) : (
              <NotAnalysed processing={m.status === 'processing'} />
            )}
          </Card>
        )}

        {tab === 'shots' && (
          <Card title="Shot map" subtitle="Every shot with its expected-goals value">
            {!analysed ? (
              <NotAnalysed processing={m.status === 'processing'} />
            ) : shotsQuery.isPending ? (
              <LoadingBlock rows={4} label="Loading shots" />
            ) : shotsQuery.error ? (
              <ErrorState error={shotsQuery.error} onRetry={() => void shotsQuery.refetch()} />
            ) : (
              <ShotMap
                shots={shotsQuery.data ?? []}
                homeTeamId={m.homeTeamId}
                homeName={m.homeTeam.shortName}
                awayName={m.awayTeam.shortName}
                playerName={playerName}
              />
            )}
          </Card>
        )}

        {tab === 'network' && (
          <Card title="Passing network" subtitle="Who connects with whom, and where they receive">
            {analysed ? (
              <PassingNetwork
                home={home?.passingNetwork}
                away={away?.passingNetwork}
                homeName={m.homeTeam.shortName}
                awayName={m.awayTeam.shortName}
                player={player}
              />
            ) : (
              <NotAnalysed processing={m.status === 'processing'} />
            )}
          </Card>
        )}

        {tab === 'players' && (
          <Card title="Player stats" subtitle="Click a column to sort · ratings from the analytics engine">
            {analysed ? (
              <PlayerStatsTable
                stats={d.playerStats}
                player={player}
                homeTeamId={m.homeTeamId}
                homeName={m.homeTeam.shortName}
                awayName={m.awayTeam.shortName}
              />
            ) : (
              <NotAnalysed processing={m.status === 'processing'} />
            )}
          </Card>
        )}

        {tab === 'report' && (
          <Card>
            <MatchReportPanel
              matchId={id}
              home={m.homeTeam}
              away={m.awayTeam}
              analysed={m.status === 'analysed' || analysed}
              resolve={resolve}
              playerName={playerName}
            />
          </Card>
        )}
      </TabPanel>
    </div>
  );
}
