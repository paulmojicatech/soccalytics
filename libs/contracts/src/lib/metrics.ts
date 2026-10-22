import { z } from 'zod';
import { Id, Point } from './common.js';
import { Position } from './domain.js';

/**
 * Canonical metric keys. Every number the platform shows — and every number
 * the LLM is allowed to cite — must be one of these, so reports stay grounded.
 */
export const PlayerMetricKey = z.enum([
  // volume
  'minutes',
  // physical (tracking)
  'distance_km',
  'hsr_distance_m',
  'sprint_count',
  'top_speed_kmh',
  // possession
  'passes',
  'pass_accuracy',
  'progressive_passes',
  'progressive_carries',
  'key_passes',
  'crosses',
  'dribbles_completed',
  'xt_added',
  // shooting
  'shots',
  'shots_on_target',
  'goals',
  'xg',
  'xa',
  // defending
  'pressures',
  'pressure_regains',
  'tackles_won',
  'interceptions',
  'recoveries',
  'clearances',
]);
export type PlayerMetricKey = z.infer<typeof PlayerMetricKey>;

export const PlayerMetrics = z.record(PlayerMetricKey, z.number());
export type PlayerMetrics = Record<PlayerMetricKey, number>;

/** Metrics where a lower value is better (none today, reserved for e.g. turnovers). */
export const LOWER_IS_BETTER: ReadonlySet<PlayerMetricKey> = new Set();

/** Metrics that are rates/maxima and must not be scaled per-90. */
export const NON_ADDITIVE_METRICS: ReadonlySet<PlayerMetricKey> = new Set([
  'minutes',
  'pass_accuracy',
  'top_speed_kmh',
]);

export const METRIC_META: Record<PlayerMetricKey, { label: string; unit?: string; group: MetricGroup }> = {
  minutes: { label: 'Minutes', unit: 'min', group: 'volume' },
  distance_km: { label: 'Distance covered', unit: 'km', group: 'physical' },
  hsr_distance_m: { label: 'High-speed running', unit: 'm', group: 'physical' },
  sprint_count: { label: 'Sprints', group: 'physical' },
  top_speed_kmh: { label: 'Top speed', unit: 'km/h', group: 'physical' },
  passes: { label: 'Passes', group: 'possession' },
  pass_accuracy: { label: 'Pass accuracy', unit: '%', group: 'possession' },
  progressive_passes: { label: 'Progressive passes', group: 'possession' },
  progressive_carries: { label: 'Progressive carries', group: 'possession' },
  key_passes: { label: 'Key passes', group: 'possession' },
  crosses: { label: 'Crosses', group: 'possession' },
  dribbles_completed: { label: 'Dribbles completed', group: 'possession' },
  xt_added: { label: 'xT added', group: 'possession' },
  shots: { label: 'Shots', group: 'shooting' },
  shots_on_target: { label: 'Shots on target', group: 'shooting' },
  goals: { label: 'Goals', group: 'shooting' },
  xg: { label: 'Expected goals (xG)', group: 'shooting' },
  xa: { label: 'Expected assists (xA)', group: 'shooting' },
  pressures: { label: 'Pressures', group: 'defending' },
  pressure_regains: { label: 'Pressure regains', group: 'defending' },
  tackles_won: { label: 'Tackles won', group: 'defending' },
  interceptions: { label: 'Interceptions', group: 'defending' },
  recoveries: { label: 'Ball recoveries', group: 'defending' },
  clearances: { label: 'Clearances', group: 'defending' },
};

export const MetricGroup = z.enum(['volume', 'physical', 'possession', 'shooting', 'defending']);
export type MetricGroup = z.infer<typeof MetricGroup>;

export const PlayerMatchStats = z.object({
  matchId: Id,
  playerId: Id,
  teamId: Id,
  position: Position,
  metrics: PlayerMetrics,
  /** 0–10 composite match rating from the analytics engine. */
  rating: z.number(),
  /** Mean on-ball location (for passing network / heatmap anchor). */
  avgPosition: Point,
});
export type PlayerMatchStats = z.infer<typeof PlayerMatchStats>;

export const PassingNetwork = z.object({
  teamId: Id,
  nodes: z.array(z.object({ playerId: Id, x: z.number(), y: z.number(), touches: z.number() })),
  edges: z.array(z.object({ from: Id, to: Id, count: z.number() })),
});
export type PassingNetwork = z.infer<typeof PassingNetwork>;

export const TeamMatchStats = z.object({
  matchId: Id,
  teamId: Id,
  goals: z.number(),
  xg: z.number(),
  shots: z.number(),
  possessionPct: z.number(),
  passes: z.number(),
  passAccuracy: z.number(),
  /** Passes allowed per defensive action — lower means more intense pressing. */
  ppda: z.number(),
  /** Share of final-third passes made by this team. */
  fieldTilt: z.number(),
  progressivePasses: z.number(),
  pressures: z.number(),
  highRegains: z.number(),
  distanceKm: z.number(),
  passingNetwork: PassingNetwork,
  /** Cumulative xG at 5-minute buckets, for the xG race chart. */
  xgTimeline: z.array(z.object({ minute: z.number(), xg: z.number() })),
});
export type TeamMatchStats = z.infer<typeof TeamMatchStats>;

/** Per-90 aggregate over a window of matches. */
export const PlayerProfile = z.object({
  playerId: Id,
  position: Position,
  matches: z.number().int(),
  minutes: z.number(),
  per90: PlayerMetrics,
  avgRating: z.number(),
});
export type PlayerProfile = z.infer<typeof PlayerProfile>;

export const BenchmarkCohort = z.enum(['position_peers', 'team', 'pro_reference']);
export type BenchmarkCohort = z.infer<typeof BenchmarkCohort>;

export const MetricBenchmark = z.object({
  metric: PlayerMetricKey,
  value: z.number(),
  cohortMedian: z.number(),
  percentile: z.number(),
  zScore: z.number(),
});
export type MetricBenchmark = z.infer<typeof MetricBenchmark>;

export const PlayerBenchmark = z.object({
  playerId: Id,
  cohort: BenchmarkCohort,
  cohortSize: z.number().int(),
  metrics: z.array(MetricBenchmark),
  strengths: z.array(PlayerMetricKey),
  weaknesses: z.array(PlayerMetricKey),
});
export type PlayerBenchmark = z.infer<typeof PlayerBenchmark>;

export const TrendPoint = z.object({
  matchId: Id,
  kickoffAt: z.string(),
  rating: z.number(),
  metrics: PlayerMetrics,
});
export type TrendPoint = z.infer<typeof TrendPoint>;

export const PlayerTrend = z.object({
  playerId: Id,
  points: z.array(TrendPoint),
  /** Linear-fit slope of rating per match. */
  ratingSlope: z.number(),
  /** Projected rating N matches ahead with an 80% prediction interval. */
  projection: z.object({
    horizonMatches: z.number().int(),
    rating: z.number(),
    low: z.number(),
    high: z.number(),
  }),
});
export type PlayerTrend = z.infer<typeof PlayerTrend>;

export const SimilarPlayer = z.object({
  playerId: Id,
  name: z.string(),
  teamName: z.string(),
  position: Position,
  similarity: z.number(),
});
export type SimilarPlayer = z.infer<typeof SimilarPlayer>;
