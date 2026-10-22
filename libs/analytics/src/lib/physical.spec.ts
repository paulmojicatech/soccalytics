import type { TrackingDocument } from '@soccalytics/contracts';
import { computePhysical } from './physical.js';

function doc(path: (t: number) => { x: number; y: number }, seconds: number, fps = 10): TrackingDocument {
  const frames = Array.from({ length: seconds * fps + 1 }, (_, i) => {
    const t = i / fps;
    const p = path(t);
    return { period: 1, t, ball: null, players: [{ playerId: 'p', teamId: 'h', x: p.x, y: p.y }] };
  });
  return {
    meta: { matchId: 'm', fps, frameCount: frames.length, homeTeamId: 'h', awayTeamId: 'a', homeAttacksRight: [true, false], source: 'gps' },
    frames,
  };
}

describe('computePhysical', () => {
  it('measures distance, HSR, sprints and top speed', () => {
    // 10 s jogging at 3 m/s, 3 s sprinting at 8 m/s, 10 s jogging
    const path = (t: number) => {
      if (t <= 10) return { x: 3 * t, y: 10 };
      if (t <= 13) return { x: 30 + 8 * (t - 10), y: 10 };
      return { x: 54 + 3 * (t - 13), y: 10 };
    };
    const m = computePhysical(doc(path, 23)).get('p');
    expect(m).toBeDefined();
    expect(m?.distance_km).toBeCloseTo(0.084, 2);
    expect(m?.sprint_count).toBe(1);
    expect(m?.hsr_distance_m).toBeGreaterThan(18);
    expect(m?.hsr_distance_m).toBeLessThan(32);
    expect(m?.top_speed_kmh).toBeGreaterThan(27);
    expect(m?.top_speed_kmh).toBeLessThan(29.5);
  });

  it('does not count short bursts or tracking teleports', () => {
    const path = (t: number) => {
      if (t < 5) return { x: 2 * t, y: 10 };
      if (t < 5.5) return { x: 10 + 8 * (t - 5), y: 10 }; // 0.5 s burst
      if (t < 8) return { x: 14 + 2 * (t - 5.5), y: 10 };
      return { x: 60 + 2 * (t - 8), y: 10 }; // identity swap: 41 m jump
    };
    const m = computePhysical(doc(path, 12)).get('p');
    expect(m?.sprint_count).toBe(0);
    expect(m?.distance_km).toBeLessThan(0.03);
    expect(m?.top_speed_kmh).toBeLessThan(25.2);
  });
});
