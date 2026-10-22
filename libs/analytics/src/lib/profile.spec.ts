import { PlayerMetricKey, type PlayerMatchStats, type PlayerProfile } from '@soccalytics/contracts';
import { emptyMetrics } from './match-stats.js';
import { aggregateProfile, benchmarkPlayer } from './profile.js';

const stat = (over: Partial<Record<PlayerMetricKey, number>>, rating = 6.5): PlayerMatchStats => ({
  matchId: 'm',
  playerId: 'p',
  teamId: 't',
  position: 'CM',
  metrics: { ...emptyMetrics(), ...over },
  rating,
  avgPosition: { x: 50, y: 34 },
});

describe('aggregateProfile', () => {
  it('scales additive metrics per 90 and handles non-additive ones', () => {
    const prof = aggregateProfile('p', 'CM', [
      stat({ minutes: 90, passes: 40, pass_accuracy: 90, goals: 1, top_speed_kmh: 30 }, 7),
      stat({ minutes: 45, passes: 10, pass_accuracy: 50, goals: 0, top_speed_kmh: 32 }, 6),
    ]);
    expect(prof.minutes).toBe(135);
    expect(prof.matches).toBe(2);
    expect(prof.per90.passes).toBeCloseTo((50 / 135) * 90, 3);
    expect(prof.per90.goals).toBeCloseTo((1 / 135) * 90, 3);
    expect(prof.per90.pass_accuracy).toBe(82); // (40·90 + 10·50) / 50
    expect(prof.per90.top_speed_kmh).toBe(32);
    expect(prof.per90.minutes).toBe(135);
    expect(prof.avgRating).toBe(6.5);
  });

  it('returns zeros without minutes', () => {
    const prof = aggregateProfile('p', 'CM', []);
    expect(prof.per90.passes).toBe(0);
    expect(prof.avgRating).toBe(0);
  });
});

describe('benchmarkPlayer', () => {
  const mk = (id: string, goals: number, tackles: number): PlayerProfile => ({
    playerId: id,
    position: 'ST',
    matches: 5,
    minutes: 450,
    per90: { ...emptyMetrics(), goals, tackles_won: tackles },
    avgRating: 6.5,
  });
  const cohort = [mk('a', 0.1, 3), mk('b', 0.2, 2), mk('c', 0.3, 1), mk('d', 0.4, 0.5), mk('e', 0.9, 0.1)];

  it('computes percentile ranks, z-scores, strengths and weaknesses', () => {
    const b = benchmarkPlayer(cohort[4] as PlayerProfile, cohort, 'position_peers');
    const goals = b.metrics.find((m) => m.metric === 'goals');
    expect(goals?.percentile).toBe(90); // 4 below + 0.5 equal of 5
    expect(goals?.cohortMedian).toBe(0.3);
    expect(goals?.zScore).toBeGreaterThan(1.5);
    expect(b.metrics.some((m) => m.metric === 'minutes')).toBe(false);
    expect(b.strengths).toContain('goals');
    expect(b.weaknesses).toContain('tackles_won');
    expect(b.cohortSize).toBe(5);
    // all-equal metrics sit at the 50th percentile with z = 0
    const passes = b.metrics.find((m) => m.metric === 'passes');
    expect(passes?.percentile).toBe(50);
    expect(passes?.zScore).toBe(0);
  });
});
