import { PlayerMetricKey, type PlayerProfile } from '@soccalytics/contracts';
import { mean, std } from './math.js';

/** Fixed key order of profile embeddings (all per-90 metrics except minutes). */
export const VECTOR_KEYS: readonly PlayerMetricKey[] = PlayerMetricKey.options.filter((k) => k !== 'minutes');
export const VECTOR_DIM: number = VECTOR_KEYS.length;

export type VectorStats = Partial<Record<PlayerMetricKey, { mean: number; std: number }>>;

/**
 * Reference per-90 means/SDs (youth-to-semi-pro outfield population) used to
 * standardise vectors when no cohort statistics are supplied.
 */
export const DEFAULT_VECTOR_STATS: Record<PlayerMetricKey, { mean: number; std: number }> = {
  minutes: { mean: 900, std: 400 },
  distance_km: { mean: 10, std: 1.5 },
  hsr_distance_m: { mean: 600, std: 250 },
  sprint_count: { mean: 15, std: 8 },
  top_speed_kmh: { mean: 30, std: 2.5 },
  passes: { mean: 40, std: 15 },
  pass_accuracy: { mean: 80, std: 7 },
  progressive_passes: { mean: 3, std: 2 },
  progressive_carries: { mean: 1.5, std: 1.2 },
  key_passes: { mean: 0.8, std: 0.7 },
  crosses: { mean: 1.2, std: 1.5 },
  dribbles_completed: { mean: 1, std: 1 },
  xt_added: { mean: 0.1, std: 0.12 },
  shots: { mean: 1.2, std: 1.1 },
  shots_on_target: { mean: 0.45, std: 0.5 },
  goals: { mean: 0.12, std: 0.18 },
  xg: { mean: 0.12, std: 0.15 },
  xa: { mean: 0.09, std: 0.1 },
  pressures: { mean: 12, std: 6 },
  pressure_regains: { mean: 2.5, std: 1.8 },
  tackles_won: { mean: 1.5, std: 1 },
  interceptions: { mean: 1.5, std: 1.1 },
  recoveries: { mean: 4, std: 2 },
  clearances: { mean: 1.5, std: 2 },
};

/** Mean/SD of each vector key across a cohort of profiles. */
export function cohortStats(profiles: readonly PlayerProfile[]): Record<PlayerMetricKey, { mean: number; std: number }> {
  const out = {} as Record<PlayerMetricKey, { mean: number; std: number }>;
  for (const k of PlayerMetricKey.options) {
    const xs = profiles.map((p) => p.per90[k]);
    out[k] = { mean: mean(xs), std: std(xs) };
  }
  return out;
}

/**
 * Standardised (z-scored) per-90 vector in VECTOR_KEYS order — suitable for
 * cosine similarity / pgvector. z-scores are clipped to ±4.
 */
export function profileVector(profile: PlayerProfile, stats?: VectorStats): number[] {
  return VECTOR_KEYS.map((k) => {
    const s = stats?.[k] ?? DEFAULT_VECTOR_STATS[k];
    const sd = s.std > 1e-9 ? s.std : 1;
    const z = (profile.per90[k] - s.mean) / sd;
    return Math.max(-4, Math.min(4, Number.isFinite(z) ? z : 0));
  });
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
