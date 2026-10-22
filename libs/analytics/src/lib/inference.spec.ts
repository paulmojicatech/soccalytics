import type { TrackingDocument, TrackingFrame } from '@soccalytics/contracts';
import { inferEventsFromTracking } from './inference.js';

/**
 * Tiny synthetic scene at 5 fps (raw orientation, home attacks right in period 1):
 *  - h1 holds the ball at (40,34) for 1 s, passes to h2 at (60,34)
 *  - h2 carries it 10 m to (70,34) while a1 closes in, then passes towards (85,34)
 *    where opponent a2 intercepts it.
 */
function scene(period: number, homeAttacksRight: boolean): TrackingDocument {
  const fps = 5;
  const frames: TrackingFrame[] = [];
  const flip = (x: number, y: number) => (homeAttacksRight ? { x, y } : { x: 105 - x, y: 68 - y });
  const push = (t: number, ball: [number, number], h1: [number, number], h2: [number, number], a1: [number, number], a2: [number, number]) => {
    const b = flip(...ball);
    frames.push({
      period,
      t,
      ball: { x: b.x, y: b.y, z: 0 },
      players: [
        { playerId: 'h1', teamId: 'H', ...flip(...h1) },
        { playerId: 'h2', teamId: 'H', ...flip(...h2) },
        { playerId: 'a1', teamId: 'A', ...flip(...a1) },
        { playerId: 'a2', teamId: 'A', ...flip(...a2) },
      ],
    });
  };
  let t = 0;
  const step = () => (t = Math.round((t + 1 / fps) * 100) / 100);
  // h1 in possession, 1 s
  for (let i = 0; i < 5; i++, step()) push(t, [40.4, 34], [40, 34], [60, 34], [75, 30], [88, 34]);
  // ball travels 20 m in 1 s
  for (let i = 1; i <= 4; i++, step()) push(t, [40.4 + i * 4, 34], [40, 34], [60, 34], [75, 30], [88, 34]);
  // h2 carries 10 m over 2 s; a1 closes from 8 m to 2 m
  for (let i = 0; i <= 10; i++, step()) {
    const x = 60 + i;
    push(t, [x + 0.4, 34], [40, 34], [x, 34], [x + 8 - 0.6 * i, 33], [88, 34]);
  }
  // pass towards 85 intercepted by a2 at 85
  for (let i = 1; i <= 3; i++, step()) push(t, [70.4 + i * 4.9, 34], [40, 34], [70, 34], [73, 33], [86, 34]);
  for (let i = 0; i < 5; i++, step()) push(t, [85, 34], [40, 34], [70, 34], [73, 33], [85.4, 34]);
  return {
    meta: { matchId: 'm', fps, frameCount: frames.length, homeTeamId: 'H', awayTeamId: 'A', homeAttacksRight: period === 1 ? [homeAttacksRight, !homeAttacksRight] : [!homeAttacksRight, homeAttacksRight], source: 'cv' },
    frames,
  };
}

describe('inferEventsFromTracking', () => {
  for (const [period, right] of [
    [1, true],
    [2, false],
  ] as const) {
    it(`detects pass, carry, pressure and interception (period ${period})`, () => {
      const ev = inferEventsFromTracking(scene(period, right));
      const types = ev.map((e) => `${e.playerId}:${e.type}:${e.success}`);
      expect(types).toContain('h1:pass:true');
      expect(types).toContain('h2:carry:true');
      expect(types).toContain('a1:pressure:true');
      expect(types).toContain('h2:pass:false');
      expect(types).toContain('a2:interception:true');
      const pass = ev.find((e) => e.playerId === 'h1' && e.type === 'pass');
      expect(pass?.recipientId).toBe('h2');
      // normalised: home attacks towards x = 105 regardless of raw direction
      expect(pass?.start.x).toBeCloseTo(40.4, 1);
      expect(pass?.end.x).toBeGreaterThan(55);
      const carry = ev.find((e) => e.type === 'carry');
      expect((carry?.end.x ?? 0) - (carry?.start.x ?? 0)).toBeGreaterThan(9);
      // interception is in the away team's frame
      const int = ev.find((e) => e.type === 'interception');
      expect(int?.start.x).toBeCloseTo(105 - 85, 0);
      for (const e of ev) {
        expect(e.confidence).toBeLessThan(1);
        expect(e.id).toMatch(/^m-ev-\d+$/);
      }
    });
  }

  it('detects a goal-bound shot', () => {
    const fps = 5;
    const frames: TrackingFrame[] = [];
    let t = 0;
    for (let i = 0; i < 5; i++, t += 0.2) frames.push({ period: 1, t, ball: { x: 90.4, y: 34, z: 0 }, players: [{ playerId: 's', teamId: 'H', x: 90, y: 34 }, { playerId: 'k', teamId: 'A', x: 103, y: 30 }] });
    for (let i = 1; i <= 4; i++, t += 0.2) frames.push({ period: 1, t, ball: { x: 90.4 + i * 4, y: 34, z: 0.5 }, players: [{ playerId: 's', teamId: 'H', x: 90, y: 34 }, { playerId: 'k', teamId: 'A', x: 103, y: 30 }] });
    const doc: TrackingDocument = {
      meta: { matchId: 'm', fps, frameCount: frames.length, homeTeamId: 'H', awayTeamId: 'A', homeAttacksRight: [true, false], source: 'cv' },
      frames,
    };
    const shot = inferEventsFromTracking(doc).find((e) => e.type === 'shot');
    expect(shot).toBeDefined();
    expect(shot?.success).toBe(true);
  });
});
