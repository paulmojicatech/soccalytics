import { enrichEvents } from './enrich.js';

describe('enrichEvents', () => {
  it('validates and attaches xg / xt / progressive', () => {
    const base = { matchId: 'm', teamId: 't', playerId: 'p', period: 1, t: 1 };
    const out = enrichEvents([
      { ...base, id: 'a', type: 'shot', start: { x: 94, y: 34 }, end: { x: 105, y: 34 }, success: true },
      { ...base, id: 'b', type: 'pass', start: { x: 60, y: 34 }, end: { x: 90, y: 34 }, success: true },
      { ...base, id: 'c', type: 'pass', start: { x: 60, y: 34 }, end: { x: 90, y: 34 }, success: false },
      { ...base, id: 'd', type: 'tackle', start: { x: 30, y: 34 }, end: { x: 30, y: 34 }, success: true },
    ]);
    expect(out[0]?.xg).toBeGreaterThan(0.1);
    expect(out[0]?.xt).toBeNull();
    expect(out[1]?.xt).toBeGreaterThan(0);
    expect(out[1]?.progressive).toBe(true);
    expect(out[2]?.xt).toBeNull();
    expect(out[2]?.progressive).toBe(false);
    expect(out[3]?.xg).toBeNull();
    expect(out[3]?.bodyPart).toBe('foot');
  });

  it('rejects invalid events', () => {
    expect(() => enrichEvents([{ id: 'x' } as never])).toThrow();
  });
});
