import type { PlayerTrend, TrendPoint } from '@soccalytics/contracts';
import { clamp, mean, round } from './math.js';

/** z for a two-sided 80 % interval (normal approximation to Student's t). */
export const Z80 = 1.2816;
/** Residual SD assumed when there are too few points to estimate it. */
export const DEFAULT_RATING_SD = 0.8;

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Residual standard error (n − 2 dof); NaN when n < 3. */
  residualSe: number;
  n: number;
  xMean: number;
  sxx: number;
}

/** Ordinary least squares of y on x. */
export function linearFit(xs: readonly number[], ys: readonly number[]): LinearFit {
  const n = xs.length;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - xMean;
    sxx += dx * dx;
    sxy += dx * ((ys[i] as number) - yMean);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = yMean - slope * xMean;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += ((ys[i] as number) - (intercept + slope * (xs[i] as number))) ** 2;
  const residualSe = n >= 3 ? Math.sqrt(ssr / (n - 2)) : NaN;
  return { slope, intercept, residualSe, n, xMean, sxx };
}

/**
 * Rating trend: OLS slope of rating against match index (chronological),
 * projected `horizon` matches beyond the last one with an 80 % prediction
 * interval  ŷ ± 1.28 · s · √(1 + 1/n + (x₀ − x̄)² / Sxx).
 *
 * With n < 3 the slope is not trusted (n = 2 is damped by half, n ≤ 1 is 0)
 * and a default residual SD of 0.8 rating points is used.
 */
export function playerTrend(playerId: string, points: readonly TrendPoint[], horizon = 5): PlayerTrend {
  const sorted = [...points].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  const n = sorted.length;
  const ys = sorted.map((p) => p.rating);
  const xs = sorted.map((_, i) => i);
  if (n === 0) {
    return {
      playerId,
      points: [],
      ratingSlope: 0,
      projection: { horizonMatches: horizon, rating: 6, low: round(6 - Z80 * DEFAULT_RATING_SD * 1.5, 2), high: round(6 + Z80 * DEFAULT_RATING_SD * 1.5, 2) },
    };
  }
  const fit = linearFit(xs, ys);
  const x0 = n - 1 + horizon;
  let slope: number;
  let yHat: number;
  let half: number;
  if (n >= 3) {
    slope = fit.slope;
    yHat = fit.intercept + slope * x0;
    const s = fit.residualSe > 0 ? fit.residualSe : 0.05;
    half = Z80 * s * Math.sqrt(1 + 1 / n + (x0 - fit.xMean) ** 2 / fit.sxx);
  } else {
    slope = n === 2 ? fit.slope * 0.5 : 0;
    const last = ys[n - 1] as number;
    yHat = mean(ys) + slope * (x0 - fit.xMean);
    if (n === 1) yHat = last;
    half = Z80 * DEFAULT_RATING_SD * Math.sqrt(1 + 1 / n + horizon / 2);
  }
  const rating = clamp(yHat, 0, 10);
  return {
    playerId,
    points: sorted,
    ratingSlope: round(slope, 4),
    projection: {
      horizonMatches: horizon,
      rating: round(rating, 2),
      low: round(clamp(yHat - half, 0, 10), 2),
      high: round(clamp(yHat + half, 0, 10), 2),
    },
  };
}
