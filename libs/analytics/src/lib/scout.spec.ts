import type { Player, ScoutFilter } from '@soccalytics/contracts';
import { emptyMetrics } from './match-stats.js';
import { rankScoutCandidates, type ScoutCandidate } from './scout.js';

const cand = (id: string, over: Partial<ScoutCandidate> & { foot?: Player['foot']; position?: Player['position'] }): ScoutCandidate => ({
  player: { id, teamId: 't', name: id.toUpperCase(), shirtNumber: 9, position: over.position ?? 'ST', birthDate: '2008-01-01', heightCm: 180, foot: over.foot ?? 'right', nationality: null },
  teamName: 'Team',
  age: over.age ?? 18,
  profile: { playerId: id, position: over.position ?? 'ST', matches: 5, minutes: 450, per90: { ...emptyMetrics(), goals: 0.5 }, avgRating: 6.8, ...over.profile },
  percentiles: over.percentiles ?? {},
  similarity: over.similarity,
});

const filter = (over: Partial<ScoutFilter>): ScoutFilter => ({
  positions: [],
  maxAge: null,
  minAge: null,
  minMinutes: null,
  foot: null,
  metricThresholds: [],
  rankBy: [],
  similarToPlayerName: null,
  interpretation: 'test',
  ...over,
});

describe('rankScoutCandidates', () => {
  const pool = [
    cand('a', { percentiles: { goals: 90, xg: 40 }, age: 17 }),
    cand('b', { percentiles: { goals: 60, xg: 95 }, age: 19, foot: 'left' }),
    cand('c', { percentiles: { goals: 99, xg: 99 }, age: 23 }),
    cand('d', { percentiles: { goals: 80, xg: 80 }, position: 'CB', foot: 'both' }),
  ];

  it('applies hard filters', () => {
    const r = rankScoutCandidates(filter({ positions: ['ST'], maxAge: 21 }), pool);
    expect(r.map((x) => x.playerId).sort()).toEqual(['a', 'b']);
    const left = rankScoutCandidates(filter({ foot: 'left' }), pool);
    expect(left.map((x) => x.playerId).sort()).toEqual(['b', 'd']);
    const thr = rankScoutCandidates(filter({ metricThresholds: [{ metric: 'xg', minPercentile: 80 }] }), pool);
    expect(thr.map((x) => x.playerId).sort()).toEqual(['b', 'c', 'd']);
  });

  it('ranks by weighted percentiles with the first metric most important', () => {
    const r = rankScoutCandidates(filter({ positions: ['ST'], maxAge: 21, rankBy: ['goals', 'xg'] }), pool);
    // a: (2·90 + 40)/3 = 73.3, b: (2·60 + 95)/3 = 71.7
    expect(r.map((x) => x.playerId)).toEqual(['a', 'b']);
    expect(r[0]?.score).toBeCloseTo(73.3, 1);
    expect(r[0]?.highlights.map((h) => h.metric)).toEqual(['goals', 'xg']);
    expect(r[0]?.highlights[0]?.per90).toBe(0.5);
  });

  it('blends similarity when present', () => {
    const r = rankScoutCandidates(filter({}), [cand('x', { similarity: 1 }), cand('y', { similarity: 0 })]);
    expect(r[0]?.playerId).toBe('x');
    expect(r[0]?.score).toBe(100);
    expect(r[1]?.score).toBe(50);
  });
});
