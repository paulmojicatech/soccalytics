import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';
import type {
  AiArtifactMeta,
  MatchReport,
  PlayerEvaluation,
  PlayerMetrics,
  PlayerProfile,
  Point,
  StageState,
  TeamMatchStats,
} from '@soccalytics/contracts';

/** Dimension of the per-90 style embedding (one slot per metric except minutes). */
export const EMBEDDING_DIM = 23;

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  level: text('level').notNull(),
  primaryColor: text('primary_color').notNull(),
  secondaryColor: text('secondary_color').notNull(),
  createdAt: createdAt(),
});

export const players = pgTable(
  'players',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull().references(() => teams.id),
    name: text('name').notNull(),
    shirtNumber: integer('shirt_number').notNull(),
    position: text('position').notNull(),
    birthDate: text('birth_date').notNull(),
    heightCm: integer('height_cm'),
    foot: text('foot').notNull(),
    nationality: text('nationality'),
    /** Simulator ground truth — never exposed via the API; used by evals. */
    latentAttributes: jsonb('latent_attributes').$type<Record<string, number>>(),
    createdAt: createdAt(),
  },
  (t) => [index('players_team_idx').on(t.teamId)],
);

export const matches = pgTable('matches', {
  id: text('id').primaryKey(),
  homeTeamId: text('home_team_id').notNull().references(() => teams.id),
  awayTeamId: text('away_team_id').notNull().references(() => teams.id),
  kickoffAt: timestamp('kickoff_at', { withTimezone: true }).notNull(),
  competition: text('competition').notNull(),
  venue: text('venue'),
  status: text('status').notNull(),
  source: text('source').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  durationSec: integer('duration_sec'),
  videoKey: text('video_key'),
  trackingKey: text('tracking_key'),
  createdAt: createdAt(),
});

export const lineups = pgTable(
  'lineups',
  {
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    playerId: text('player_id').notNull().references(() => players.id),
    starter: boolean('starter').notNull(),
    minutesPlayed: real('minutes_played').notNull(),
    position: text('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.playerId] })],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    playerId: text('player_id').notNull(),
    period: integer('period').notNull(),
    t: real('t').notNull(),
    type: text('type').notNull(),
    start: jsonb('start').$type<Point>().notNull(),
    end: jsonb('end').$type<Point>().notNull(),
    success: boolean('success').notNull(),
    bodyPart: text('body_part').notNull(),
    playPattern: text('play_pattern').notNull(),
    recipientId: text('recipient_id'),
    xg: real('xg'),
    xt: real('xt'),
    progressive: boolean('progressive').notNull(),
    confidence: real('confidence').notNull(),
  },
  (t) => [index('events_match_idx').on(t.matchId, t.type), index('events_player_idx').on(t.playerId)],
);

export const playerMatchStats = pgTable(
  'player_match_stats',
  {
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull().references(() => players.id),
    teamId: text('team_id').notNull(),
    position: text('position').notNull(),
    metrics: jsonb('metrics').$type<PlayerMetrics>().notNull(),
    rating: real('rating').notNull(),
    avgPosition: jsonb('avg_position').$type<Point>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.playerId] }), index('pms_player_idx').on(t.playerId)],
);

export const teamMatchStats = pgTable(
  'team_match_stats',
  {
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    stats: jsonb('stats').$type<TeamMatchStats>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.teamId] })],
);

/** Rolling per-90 profile + style embedding used for similarity search. */
export const playerProfiles = pgTable(
  'player_profiles',
  {
    playerId: text('player_id').primaryKey().references(() => players.id),
    profile: jsonb('profile').$type<PlayerProfile>().notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index('player_profiles_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))],
);

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    stages: jsonb('stages').$type<StageState[]>().notNull(),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_match_idx').on(t.matchId)],
);

export const matchReports = pgTable(
  'match_reports',
  {
    matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    report: jsonb('report').$type<MatchReport>().notNull(),
    meta: jsonb('meta').$type<AiArtifactMeta>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.teamId] })],
);

export const playerEvaluations = pgTable('player_evaluations', {
  playerId: text('player_id').primaryKey().references(() => players.id),
  evaluation: jsonb('evaluation').$type<PlayerEvaluation>().notNull(),
  meta: jsonb('meta').$type<AiArtifactMeta>().notNull(),
  createdAt: createdAt(),
});

/** One row per LLM request — the audit + cost ledger. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: text('id').primaryKey(),
    task: text('task').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    stopReason: text('stop_reason'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    subjectId: text('subject_id'),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_task_idx').on(t.task, t.createdAt)],
);
