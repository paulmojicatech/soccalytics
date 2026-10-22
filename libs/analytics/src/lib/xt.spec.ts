import { fitXtGrid, priorXtGrid, xtAt, XT_COLS, XT_ROWS } from './xt.js';
import { makeEvent } from './test-utils.js';
import type { MatchEvent } from '@soccalytics/contracts';

describe('xT', () => {
  it('prior is a 16×12 surface increasing towards goal', () => {
    const g = priorXtGrid();
    expect(g.values).toHaveLength(XT_ROWS);
    expect(g.values[0]).toHaveLength(XT_COLS);
    let prev = 0;
    for (let x = 3; x < 105; x += 6.5) {
      const v = xtAt(g, { x, y: 34 });
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(xtAt(g, { x: 5, y: 34 })).toBeLessThan(0.01);
    expect(xtAt(g, { x: 101, y: 34 })).toBeGreaterThan(0.2);
  });

  it('value iteration propagates shot value back along passing chains', () => {
    const events: MatchEvent[] = [];
    // zone A (x≈30) always passes to zone B (x≈70), which always passes into the box, where shots score half the time
    for (let i = 0; i < 200; i++) {
      events.push(makeEvent({ type: 'pass', start: { x: 30, y: 34 }, end: { x: 70, y: 34 }, success: true }));
      events.push(makeEvent({ type: 'pass', start: { x: 70, y: 34 }, end: { x: 98, y: 34 }, success: true }));
      events.push(makeEvent({ type: 'shot', start: { x: 98, y: 34 }, end: { x: 105, y: 34 }, success: i % 2 === 0 }));
    }
    const g = fitXtGrid(events, { priorStrength: 0 });
    expect(xtAt(g, { x: 98, y: 34 })).toBeCloseTo(0.5, 5);
    expect(xtAt(g, { x: 70, y: 34 })).toBeCloseTo(0.5, 5);
    expect(xtAt(g, { x: 30, y: 34 })).toBeCloseTo(0.5, 5);
    // unobserved cells fall back to the prior
    const prior = priorXtGrid();
    expect(xtAt(g, { x: 10, y: 5 })).toBeCloseTo(0, 10);
    expect(xtAt(fitXtGrid(events), { x: 10, y: 5 })).toBeCloseTo(xtAt(prior, { x: 10, y: 5 }), 10);
  });

  it('failed moves carry no value', () => {
    const events = Array.from({ length: 50 }, () =>
      makeEvent({ type: 'pass', start: { x: 70, y: 34 }, end: { x: 98, y: 34 }, success: false }),
    );
    const g = fitXtGrid(events, { priorStrength: 0 });
    expect(xtAt(g, { x: 70, y: 34 })).toBe(0);
  });
});
