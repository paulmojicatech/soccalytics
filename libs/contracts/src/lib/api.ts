import { z } from 'zod';
import { Id } from './common.js';
import { Match, Player, Team, Lineup } from './domain.js';
import { MatchEvent } from './events.js';
import {
  BenchmarkCohort,
  PlayerBenchmark,
  PlayerMatchStats,
  PlayerProfile,
  PlayerTrend,
  SimilarPlayer,
  TeamMatchStats,
} from './metrics.js';
import { ProcessingJob } from './jobs.js';
import { StoredMatchReport, StoredPlayerEvaluation } from './ai.js';

/**
 * REST surface of apps/api. The web app imports these schemas to parse
 * responses, so a contract change breaks the build on both sides.
 */

export const MatchSummary = Match.extend({
  homeTeam: Team,
  awayTeam: Team,
  homeXg: z.number().nullable(),
  awayXg: z.number().nullable(),
});
export type MatchSummary = z.infer<typeof MatchSummary>;

export const MatchDetail = z.object({
  match: MatchSummary,
  lineups: z.array(Lineup.extend({ player: Player })),
  teamStats: z.array(TeamMatchStats),
  playerStats: z.array(PlayerMatchStats),
  latestJob: ProcessingJob.nullable(),
});
export type MatchDetail = z.infer<typeof MatchDetail>;

export const MatchEventsQuery = z.object({
  types: z
    .string()
    .optional()
    .describe('Comma-separated EventType filter, e.g. "shot,pass"'),
  playerId: Id.optional(),
});

export const PlayerListItem = Player.extend({
  teamName: z.string(),
  age: z.number(),
  matches: z.number(),
  minutes: z.number(),
  avgRating: z.number().nullable(),
});
export type PlayerListItem = z.infer<typeof PlayerListItem>;

export const PlayerDetail = z.object({
  player: Player,
  team: Team,
  age: z.number(),
  profile: PlayerProfile.nullable(),
  recentMatches: z.array(PlayerMatchStats.extend({ match: MatchSummary })),
});
export type PlayerDetail = z.infer<typeof PlayerDetail>;

export const BenchmarkQuery = z.object({ cohort: BenchmarkCohort.default('position_peers') });

export const CreateUploadRequest = z.object({
  homeTeamId: Id,
  awayTeamId: Id,
  kickoffAt: z.iso.datetime(),
  competition: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().regex(/^video\//),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export const CreateUploadResponse = z.object({
  matchId: Id,
  uploadUrl: z.url(),
  videoKey: z.string(),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const StartProcessingRequest = z.object({ videoKey: z.string() });

export const SimulateMatchRequest = z.object({
  homeTeamId: Id,
  awayTeamId: Id,
  seed: z.number().int().optional(),
});
export type SimulateMatchRequest = z.infer<typeof SimulateMatchRequest>;

export const JobCreatedResponse = z.object({ matchId: Id, jobId: Id });
export type JobCreatedResponse = z.infer<typeof JobCreatedResponse>;

export const ScoutSearchRequest = z.object({ query: z.string().min(3).max(500), limit: z.number().int().max(50).default(15) });
export type ScoutSearchRequest = z.infer<typeof ScoutSearchRequest>;

export const GenerateReportRequest = z.object({ teamId: Id });

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])),
  version: z.string(),
});

export const Overview = z.object({
  teams: z.number(),
  players: z.number(),
  matchesAnalysed: z.number(),
  eventsDetected: z.number(),
  recentMatches: z.array(MatchSummary),
  activeJobs: z.array(ProcessingJob),
  topPerformers: z.array(
    z.object({ playerId: Id, name: z.string(), teamName: z.string(), position: z.string(), avgRating: z.number() }),
  ),
});
export type Overview = z.infer<typeof Overview>;

export {
  Team,
  Player,
  MatchEvent,
  PlayerBenchmark,
  PlayerTrend,
  SimilarPlayer,
  ProcessingJob,
  StoredMatchReport,
  StoredPlayerEvaluation,
};

/** Route table — single source of truth for paths used by api + web. */
export const routes = {
  health: '/health',
  overview: '/v1/overview',
  teams: '/v1/teams',
  players: '/v1/players',
  player: (id: string) => `/v1/players/${id}`,
  playerBenchmark: (id: string) => `/v1/players/${id}/benchmark`,
  playerTrend: (id: string) => `/v1/players/${id}/trend`,
  playerSimilar: (id: string) => `/v1/players/${id}/similar`,
  playerEvaluation: (id: string) => `/v1/players/${id}/evaluation`,
  matches: '/v1/matches',
  match: (id: string) => `/v1/matches/${id}`,
  matchEvents: (id: string) => `/v1/matches/${id}/events`,
  matchReport: (id: string) => `/v1/matches/${id}/report`,
  matchProcess: (id: string) => `/v1/matches/${id}/process`,
  uploads: '/v1/uploads',
  simulate: '/v1/simulations',
  job: (id: string) => `/v1/jobs/${id}`,
  jobStream: (id: string) => `/v1/jobs/${id}/stream`,
  scoutSearch: '/v1/scouting/search',
  assistantChat: '/v1/assistant/chat',
} as const;
