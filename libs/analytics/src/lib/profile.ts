import {
  LOWER_IS_BETTER,
  NON_ADDITIVE_METRICS,
  PlayerMetricKey,
  type BenchmarkCohort,
  type MetricBenchmark,
  type PlayerBenchmark,
  type PlayerMatchStats,
  type PlayerProfile,
  type Position,
} from '@soccalytics/contracts';
import { emptyMetrics } from './match-stats.js';
import { mean, median, percentileRank, round, std } from './math.js';

/**
 * Aggregate a window of matches into a per-90 profile.
 *  - additive metrics: Σ value / Σ minutes × 90;
 *  - `minutes`: total minutes in the window (not scaled);
 *  - `pass_accuracy`: pass-volume-weighted mean;
 *  - `top_speed_kmh`: maximum.
 */
export function aggregateProfile(playerId: string, position: Position, stats: readonly PlayerMatchStats[]): PlayerProfile {
  const per90 = emptyMetrics();
  const minutes = stats.reduce((a, s) => a + s.metrics.minutes, 0);
  const totalPasses = stats.reduce((a, s) => a + s.metrics.passes, 0);
  for (const key of PlayerMetricKey.options) {
    if (key === 'minutes') per90.minutes = round(minutes, 1);
    else if (key === 'pass_accuracy')
      per90.pass_accuracy = totalPasses
        ? round(stats.reduce((a, s) => a + s.metrics.pass_accuracy * s.metrics.passes, 0) / totalPasses, 1)
        : 0;
    else if (key === 'top_speed_kmh') per90.top_speed_kmh = stats.reduce((a, s) => Math.max(a, s.metrics.top_speed_kmh), 0);
    else if (!NON_ADDITIVE_METRICS.has(key))
      per90[key] = minutes > 0 ? round((stats.reduce((a, s) => a + s.metrics[key], 0) / minutes) * 90, 3) : 0;
  }
  return {
    playerId,
    position,
    matches: stats.length,
    minutes: round(minutes, 1),
    per90,
    avgRating: stats.length ? round(mean(stats.map((s) => s.rating)), 2) : 0,
  };
}

/** Metrics compared in benchmarks (everything except raw minutes). */
export const BENCHMARK_KEYS: readonly PlayerMetricKey[] = PlayerMetricKey.options.filter((k) => k !== 'minutes');

/**
 * Benchmark a profile against a cohort: percentile rank (mean-rank method,
 * inverted for lower-is-better metrics), z-score (population SD) and cohort
 * median per metric. Strengths = top 3 metrics at ≥ 70th percentile;
 * weaknesses = bottom 3 at ≤ 35th.
 */
export function benchmarkPlayer(
  profile: PlayerProfile,
  cohort: readonly PlayerProfile[],
  cohortName: BenchmarkCohort,
): PlayerBenchmark {
  const metrics: MetricBenchmark[] = BENCHMARK_KEYS.map((metric) => {
    const values = cohort.map((c) => c.per90[metric]);
    const value = profile.per90[metric];
    const sd = std(values);
    let percentile = percentileRank(value, values);
    let z = sd > 0 ? (value - mean(values)) / sd : 0;
    if (LOWER_IS_BETTER.has(metric)) {
      percentile = 100 - percentile;
      z = -z;
    }
    return {
      metric,
      value: round(value, 3),
      cohortMedian: round(median(values), 3),
      percentile: round(percentile, 1),
      zScore: round(z, 2),
    };
  });
  const byPct = [...metrics].sort((a, b) => b.percentile - a.percentile || b.zScore - a.zScore);
  return {
    playerId: profile.playerId,
    cohort: cohortName,
    cohortSize: cohort.length,
    metrics,
    strengths: byPct
      .filter((m) => m.percentile >= 70)
      .slice(0, 3)
      .map((m) => m.metric),
    weaknesses: [...byPct]
      .reverse()
      .filter((m) => m.percentile <= 35)
      .slice(0, 3)
      .map((m) => m.metric),
  };
}
