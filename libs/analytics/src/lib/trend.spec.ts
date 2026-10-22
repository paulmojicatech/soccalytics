import { emptyMetrics } from './match-stats.js';
import { linearFit, playerTrend } from './trend.js';

const pt = (i: number, rating: number) => ({
  matchId: `m${i}`,
  kickoffAt: `2026-01-${String(i + 1).padStart(2, '0')}T15:00:00Z`,
  rating,
  metrics: emptyMetrics(),
});

describe('playerTrend', () => {
  it('fits an exact linear trend', () => {
    const points = [0, 1, 2, 3, 4, 5].map((i) => pt(i, 6 + 0.1 * i));
    const tr = playerTrend('p', points.reverse(), 4);
    expect(tr.ratingSlope).toBeCloseTo(0.1, 6);
    expect(tr.points[0]?.matchId).toBe('m0'); // sorted chronologically
    expect(tr.projection.rating).toBeCloseTo(6 + 0.1 * 9, 6);
    expect(tr.projection.high - tr.projection.low).toBeLessThan(0.5);
  });

  it('computes the 80% prediction interval from residual error', () => {
    const ratings = [6.0, 7.0, 6.2, 7.2, 6.4, 7.4];
    const tr = playerTrend('p', ratings.map((r, i) => pt(i, r)), 5);
    const fit = linearFit([0, 1, 2, 3, 4, 5], ratings);
    const x0 = 10;
    const half = 1.2816 * fit.residualSe * Math.sqrt(1 + 1 / 6 + (x0 - fit.xMean) ** 2 / fit.sxx);
    expect(tr.projection.rating).toBeCloseTo(fit.intercept + fit.slope * x0, 2);
    expect((tr.projection.high - tr.projection.low) / 2).toBeCloseTo(half, 2);
  });

  it('degrades gracefully with few points', () => {
    expect(playerTrend('p', []).ratingSlope).toBe(0);
    const one = playerTrend('p', [pt(0, 7)]);
    expect(one.ratingSlope).toBe(0);
    expect(one.projection.rating).toBe(7);
    expect(one.projection.low).toBeLessThan(7);
    expect(one.projection.high).toBeGreaterThan(7);
    const two = playerTrend('p', [pt(0, 6), pt(1, 7)]);
    expect(two.ratingSlope).toBeCloseTo(0.5, 6);
    expect(two.projection.horizonMatches).toBe(5);
  });
});
