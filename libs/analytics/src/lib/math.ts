/** Small numeric helpers shared across the analytics engine. */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: readonly number[]): number => (xs.length ? sum(xs) / xs.length : 0);

/** Population standard deviation. */
export const std = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * Percentile rank (0–100) of `value` within `population` using the
 * "mean rank" convention: (#below + 0.5 · #equal) / n.
 */
export const percentileRank = (value: number, population: readonly number[]): number => {
  if (!population.length) return 50;
  let below = 0;
  let equal = 0;
  for (const p of population) {
    if (p < value - 1e-12) below++;
    else if (Math.abs(p - value) <= 1e-12) equal++;
  }
  return ((below + 0.5 * equal) / population.length) * 100;
};

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
