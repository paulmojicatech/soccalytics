import { PlayerMetricKey, type Lineup, type Match } from '@soccalytics/contracts';
import { buildXgTimeline, computeMatchStats, computePpda } from './match-stats.js';
import { makeEvent } from './test-utils.js';

const match: Match = {
  id: 'm1',
  homeTeamId: 'home',
  awayTeamId: 'away',
  kickoffAt: '2026-01-01T15:00:00Z',
  competition: 'Test',
  venue: null,
  status: 'analysed',
  source: 'simulation',
  homeScore: 1,
  awayScore: 0,
  durationSec: 5400,
};
const lineup = (playerId: string, teamId: string, position: Lineup['position'], minutesPlayed = 90): Lineup => ({
  matchId: 'm1',
  teamId,
  playerId,
  starter: true,
  minutesPlayed,
  position,
});

describe('computePpda', () => {
  it('counts opponent passes in their defensive 60% over our defensive actions in that zone', () => {
    // opponent passes: x ≤ 63 in their frame count, x > 63 does not
    const opp = [
      ...Array.from({ length: 12 }, () => makeEvent({ type: 'pass', teamId: 'away', start: { x: 30, y: 34 } })),
      ...Array.from({ length: 5 }, () => makeEvent({ type: 'pass', teamId: 'away', start: { x: 80, y: 34 } })),
    ];
    // our actions: x ≥ 42 in our frame count (= their defensive 60%)
    const own = [
      makeEvent({ type: 'tackle', start: { x: 70, y: 34 } }),
      makeEvent({ type: 'interception', start: { x: 50, y: 34 } }),
      makeEvent({ type: 'foul', start: { x: 45, y: 34 }, success: false }),
      makeEvent({ type: 'tackle', start: { x: 20, y: 34 } }), // our own third — excluded
      makeEvent({ type: 'recovery', start: { x: 70, y: 34 } }), // not a defensive action for PPDA
    ];
    expect(computePpda(own, opp)).toBe(4);
  });
});

describe('buildXgTimeline', () => {
  it('is cumulative at 5-minute buckets with second-half offset', () => {
    const shots = [
      makeEvent({ type: 'shot', period: 1, t: 4 * 60, xg: 0.1, start: { x: 90, y: 34 } }),
      makeEvent({ type: 'shot', period: 2, t: 10 * 60, xg: 0.3, start: { x: 90, y: 34 } }),
    ];
    const tl = buildXgTimeline(shots, shots);
    expect(tl[0]).toEqual({ minute: 0, xg: 0 });
    expect(tl.find((p) => p.minute === 5)?.xg).toBe(0.1);
    expect(tl.find((p) => p.minute === 50)?.xg).toBe(0.1);
    expect(tl.find((p) => p.minute === 55)?.xg).toBe(0.4);
    expect(tl.at(-1)).toEqual({ minute: 90, xg: 0.4 });
  });
});

describe('computeMatchStats', () => {
  const lineups = [lineup('h1', 'home', 'CM'), lineup('h2', 'home', 'ST'), lineup('a1', 'away', 'CB'), lineup('a2', 'away', 'GK', 45)];
  const events = [
    makeEvent({ type: 'pass', playerId: 'h1', t: 10, start: { x: 50, y: 30 }, end: { x: 85, y: 34 }, recipientId: 'h2' }),
    makeEvent({ type: 'pressure', teamId: 'away', playerId: 'a1', t: 11, start: { x: 20, y: 34 } }),
    makeEvent({ type: 'carry', playerId: 'h2', t: 11.5, start: { x: 85, y: 34 }, end: { x: 92, y: 34 } }),
    makeEvent({ type: 'shot', playerId: 'h2', t: 13, start: { x: 92, y: 34 }, end: { x: 105, y: 34 }, success: true }),
    makeEvent({ type: 'pass', playerId: 'h1', t: 60, start: { x: 50, y: 30 }, end: { x: 60, y: 34 }, recipientId: 'h2' }),
    makeEvent({ type: 'pass', playerId: 'h1', t: 70, start: { x: 50, y: 30 }, end: { x: 60, y: 34 }, recipientId: 'h2' }),
    makeEvent({ type: 'pass', playerId: 'h1', t: 80, start: { x: 50, y: 30 }, end: { x: 60, y: 34 }, success: false }),
    makeEvent({ type: 'pressure', teamId: 'away', playerId: 'a1', t: 81, start: { x: 50, y: 34 } }),
    makeEvent({ type: 'interception', teamId: 'away', playerId: 'a1', t: 82, start: { x: 45, y: 34 } }),
    makeEvent({ type: 'save', teamId: 'away', playerId: 'a2', t: 200, start: { x: 2, y: 34 } }),
  ];

  const { players, teams } = computeMatchStats({ match, lineups, events, tracking: null });
  const p = (id: string) => players.find((x) => x.playerId === id);

  it('populates every metric key for every player', () => {
    expect(players).toHaveLength(4);
    for (const pl of players) for (const k of PlayerMetricKey.options) expect(typeof pl.metrics[k]).toBe('number');
    expect(p('h1')?.metrics.distance_km).toBe(0);
  });

  it('computes passing, key passes, xA and shooting', () => {
    const h1 = p('h1')?.metrics;
    expect(h1?.passes).toBe(4);
    expect(h1?.pass_accuracy).toBe(75);
    expect(h1?.key_passes).toBe(1);
    expect(h1?.xa).toBeGreaterThan(0.1);
    expect(h1?.progressive_passes).toBe(1);
    const h2 = p('h2')?.metrics;
    expect(h2?.goals).toBe(1);
    expect(h2?.shots_on_target).toBe(1);
    expect(h2?.xg).toBeCloseTo(h1?.xa ?? 0, 5);
  });

  it('credits pressure regains within the window', () => {
    expect(p('a1')?.metrics.pressures).toBe(2);
    expect(p('a1')?.metrics.pressure_regains).toBe(1);
    expect(p('a1')?.metrics.interceptions).toBe(1);
  });

  it('builds team stats with passing network threshold', () => {
    const home = teams.find((t) => t.teamId === 'home');
    expect(home?.goals).toBe(1);
    expect(home?.passes).toBe(4);
    expect(home?.passAccuracy).toBe(75);
    expect(home?.passingNetwork.edges).toEqual([{ from: 'h1', to: 'h2', count: 3 }]);
    expect(home?.passingNetwork.nodes.find((n) => n.playerId === 'h2')?.touches).toBe(3);
    expect(home?.xgTimeline[0]?.minute).toBe(0);
    expect(home?.possessionPct).toBeGreaterThan(50);
    const ratings = players.map((x) => x.rating);
    for (const r of ratings) {
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(10);
    }
  });
});
