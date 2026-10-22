import { createHash } from 'node:crypto';
import { MatchEvent, TrackingFrame, TrackingMeta } from '@soccalytics/contracts';
import { generateLeague } from './league.js';
import { simulateMatch, type SimulateMatchResult } from './engine.js';

const league = generateLeague(42);
const squad = (i: number) => {
  const team = league.teams[i];
  if (!team) throw new Error('team');
  return { team, players: league.players.filter((p) => p.teamId === team.id) };
};
const run = (seed: number, h = 0, a = 1) => simulateMatch({ matchId: `match-${seed}`, seed, home: squad(h), away: squad(a) });
const digest = (r: SimulateMatchResult) => createHash('sha1').update(JSON.stringify(r)).digest('hex');

describe('simulateMatch', () => {
  const t0 = Date.now();
  const res = run(7);
  const elapsed = Date.now() - t0;
  const home = squad(0).team.id;
  const away = squad(1).team.id;

  it('runs fast and produces ~27k frames at 5 fps', () => {
    expect(elapsed).toBeLessThan(5000);
    expect(res.tracking.frames.length).toBeGreaterThan(5400 * 5);
    expect(res.tracking.frames.length).toBeLessThan(5900 * 5);
    expect(res.tracking.meta.frameCount).toBe(res.tracking.frames.length);
    expect(res.tracking.meta.homeAttacksRight).toEqual([true, false]);
    expect(res.durationSec).toBeGreaterThan(5400);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    expect(digest(run(7))).toBe(digest(res));
    expect(digest(run(8))).not.toBe(digest(res));
  });

  it('emits schema-valid events with deterministic ids, sorted in time', () => {
    res.events.forEach((e, i) => {
      expect(() => MatchEvent.parse(e)).not.toThrow();
      expect(e.id).toBe(`match-7-ev-${i}`);
      if (i > 0) {
        const p = res.events[i - 1] as (typeof res.events)[number];
        expect(p.period * 1e5 + p.t).toBeLessThanOrEqual(e.period * 1e5 + e.t);
      }
    });
    expect(() => TrackingMeta.parse(res.tracking.meta)).not.toThrow();
    for (const f of res.tracking.frames.slice(0, 200)) expect(() => TrackingFrame.parse(f)).not.toThrow();
  });

  it('keeps ball tracking consistent with event locations', () => {
    const fps = res.tracking.meta.fps;
    const byPeriod = [1, 2].map((p) => res.tracking.frames.filter((f) => f.period === p));
    let checked = 0;
    for (const e of res.events) {
      if (e.type !== 'pass' || !e.success) continue;
      const frames = byPeriod[e.period - 1] ?? [];
      const f = frames[Math.round(e.t * fps)];
      if (!f?.ball) continue;
      const attacksRight = (e.teamId === home) === (e.period === 1);
      const bx = attacksRight ? f.ball.x : 105 - f.ball.x;
      const by = attacksRight ? f.ball.y : 68 - f.ball.y;
      expect(Math.hypot(bx - e.start.x, by - e.start.y)).toBeLessThan(2.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('fields 11 per side, with substitutions after the hour mark', () => {
    for (const teamId of [home, away]) {
      const lu = res.lineups.filter((l) => l.teamId === teamId);
      expect(lu.filter((l) => l.starter)).toHaveLength(11);
      expect(lu).toHaveLength(18);
      const subs = lu.filter((l) => !l.starter && l.minutesPlayed > 0);
      expect(subs.length).toBeLessThanOrEqual(3);
      for (const s of subs) expect(s.minutesPlayed).toBeLessThanOrEqual(33);
      expect(lu.filter((l) => l.starter && l.position === 'GK')).toHaveLength(1);
    }
    for (const f of res.tracking.frames.filter((_, i) => i % 500 === 0)) {
      expect(f.players.filter((p) => p.teamId === home)).toHaveLength(11);
      expect(f.players.filter((p) => p.teamId === away)).toHaveLength(11);
      for (const p of f.players) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(106);
        expect(Math.round(p.x * 100) / 100).toBe(p.x);
      }
    }
  });

  it('produces realistic match totals', () => {
    for (const seed of [11, 12, 13]) {
      const r = seed === 11 ? res : run(seed, seed % 8, (seed + 3) % 8);
      const teams = [...new Set(r.lineups.map((l) => l.teamId))];
      for (const teamId of teams) {
        const ev = r.events.filter((e) => e.teamId === teamId);
        const passes = ev.filter((e) => e.type === 'pass' || e.type === 'cross');
        const acc = passes.filter((e) => e.success).length / passes.length;
        const shots = ev.filter((e) => e.type === 'shot').length;
        expect(passes.length).toBeGreaterThan(300);
        expect(passes.length).toBeLessThan(700);
        expect(acc).toBeGreaterThan(0.7);
        expect(acc).toBeLessThan(0.9);
        expect(shots).toBeGreaterThanOrEqual(1);
        expect(shots).toBeLessThan(30);
      }
      const goals = r.events.filter((e) => e.type === 'shot' && e.success);
      expect(goals.length).toBe(r.homeScore + r.awayScore);
    }
  });

  it('has players covering realistic distances', () => {
    const dist = new Map<string, number>();
    const last = new Map<string, { x: number; y: number; period: number }>();
    for (const f of res.tracking.frames) {
      for (const p of f.players) {
        const l = last.get(p.playerId);
        if (l && l.period === f.period) dist.set(p.playerId, (dist.get(p.playerId) ?? 0) + Math.hypot(p.x - l.x, p.y - l.y));
        last.set(p.playerId, { x: p.x, y: p.y, period: f.period });
      }
    }
    const full = res.lineups.filter((l) => l.minutesPlayed >= 89);
    for (const l of full) {
      const km = (dist.get(l.playerId) ?? 0) / 1000;
      if (l.position === 'GK') {
        expect(km).toBeGreaterThan(3);
        expect(km).toBeLessThan(7);
      } else {
        expect(km).toBeGreaterThan(8);
        expect(km).toBeLessThan(13);
      }
    }
  });
});
