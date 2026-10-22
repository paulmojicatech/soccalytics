/**
 * Query option factories shared by server prefetching (RSC) and client hooks,
 * so both sides agree on query keys.
 */
import { queryOptions } from '@tanstack/react-query';
import type { BenchmarkCohort, EventType } from '@soccalytics/contracts';
import { api, type PlayerFilters } from './api';

export const q = {
  overview: () => queryOptions({ queryKey: ['overview'], queryFn: api.overview }),
  teams: () => queryOptions({ queryKey: ['teams'], queryFn: api.teams, staleTime: 5 * 60_000 }),
  players: (f: PlayerFilters = {}) =>
    queryOptions({
      queryKey: ['players', f.position ?? '', f.teamId ?? '', f.q ?? ''],
      queryFn: () => api.players(f),
    }),
  player: (id: string) => queryOptions({ queryKey: ['player', id], queryFn: () => api.player(id) }),
  playerBenchmark: (id: string, cohort: BenchmarkCohort) =>
    queryOptions({ queryKey: ['player', id, 'benchmark', cohort], queryFn: () => api.playerBenchmark(id, cohort) }),
  playerTrend: (id: string) => queryOptions({ queryKey: ['player', id, 'trend'], queryFn: () => api.playerTrend(id) }),
  playerSimilar: (id: string) =>
    queryOptions({ queryKey: ['player', id, 'similar'], queryFn: () => api.playerSimilar(id) }),
  playerEvaluation: (id: string) =>
    queryOptions({ queryKey: ['player', id, 'evaluation'], queryFn: () => api.playerEvaluation(id) }),
  matches: () => queryOptions({ queryKey: ['matches'], queryFn: api.matches }),
  match: (id: string) => queryOptions({ queryKey: ['match', id], queryFn: () => api.match(id) }),
  matchEvents: (id: string, types: EventType[]) =>
    queryOptions({ queryKey: ['match', id, 'events', types.join(',')], queryFn: () => api.matchEvents(id, { types }) }),
  matchReport: (id: string, teamId: string) =>
    queryOptions({ queryKey: ['match', id, 'report', teamId], queryFn: () => api.matchReport(id, teamId) }),
  job: (id: string) => queryOptions({ queryKey: ['job', id], queryFn: () => api.job(id) }),
};
