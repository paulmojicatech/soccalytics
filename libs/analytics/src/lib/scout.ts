import type { Player, PlayerMetricKey, PlayerProfile, ScoutFilter, ScoutResult } from '@soccalytics/contracts';
import { clamp, round } from './math.js';

export type ScoutCandidate = {
  player: Player;
  teamName: string;
  age: number;
  profile: PlayerProfile;
  /** Per-90 percentiles against position peers (0–100). */
  percentiles: Partial<Record<PlayerMetricKey, number>>;
  /** Cosine similarity to the reference player (−1…1), if one was requested. */
  similarity?: number;
};

/** Weight of the similarity component when both rankBy and similarity exist. */
export const SIMILARITY_BLEND = 0.4;

/**
 * Filter and rank scouting candidates.
 *
 * Hard filters: positions (empty = any), age range, minimum minutes, foot
 * ('both'-footed players satisfy any foot request), and every
 * `metricThresholds` percentile. Score (0–100):
 *   - metric score = weighted mean of `rankBy` percentiles with linearly
 *     decaying weights (first metric = highest weight); if `rankBy` is empty
 *     the mean threshold percentile, else avgRating × 10;
 *   - with a similarity value, blended 60/40 with similarity mapped to 0–100
 *     (pure similarity if there is no rankBy).
 */
export function rankScoutCandidates(filter: ScoutFilter, candidates: readonly ScoutCandidate[]): ScoutResult[] {
  const pct = (c: ScoutCandidate, k: PlayerMetricKey): number => c.percentiles[k] ?? 0;
  const highlightKeys = [...new Set<PlayerMetricKey>([...filter.rankBy, ...filter.metricThresholds.map((t) => t.metric)])];

  const passed = candidates.filter((c) => {
    if (filter.positions.length && !filter.positions.includes(c.profile.position)) return false;
    if (filter.minAge != null && c.age < filter.minAge) return false;
    if (filter.maxAge != null && c.age > filter.maxAge) return false;
    if (filter.minMinutes != null && c.profile.minutes < filter.minMinutes) return false;
    if (filter.foot && c.player.foot !== filter.foot && c.player.foot !== 'both') return false;
    return filter.metricThresholds.every((t) => c.percentiles[t.metric] != null && pct(c, t.metric) >= t.minPercentile);
  });

  const n = filter.rankBy.length;
  const weights = filter.rankBy.map((_, i) => n - i);
  const wSum = weights.reduce((a, b) => a + b, 0);

  const scored = passed.map((c) => {
    let metricScore: number;
    if (n) metricScore = filter.rankBy.reduce((a, k, i) => a + (weights[i] as number) * pct(c, k), 0) / wSum;
    else if (filter.metricThresholds.length)
      metricScore = filter.metricThresholds.reduce((a, t) => a + pct(c, t.metric), 0) / filter.metricThresholds.length;
    else metricScore = clamp(c.profile.avgRating * 10, 0, 100);
    let score = metricScore;
    if (c.similarity != null) {
      const sim = clamp(((c.similarity + 1) / 2) * 100, 0, 100);
      score = n ? (1 - SIMILARITY_BLEND) * metricScore + SIMILARITY_BLEND * sim : sim;
    }
    const result: ScoutResult = {
      playerId: c.player.id,
      name: c.player.name,
      teamName: c.teamName,
      position: c.profile.position,
      age: c.age,
      minutes: c.profile.minutes,
      score: round(score, 1),
      highlights: highlightKeys.map((metric) => ({
        metric,
        per90: round(c.profile.per90[metric] ?? 0, 2),
        percentile: round(pct(c, metric), 1),
      })),
    };
    return result;
  });
  return scored.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
}
