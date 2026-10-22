import { xgForShot } from './xg.js';

describe('xgForShot', () => {
  const central = (x: number) => xgForShot({ start: { x, y: 34 }, bodyPart: 'foot', playPattern: 'open_play' });

  it('decreases monotonically with distance along the centre line', () => {
    let prev = Infinity;
    for (let x = 104; x >= 60; x -= 2) {
      const v = central(x);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('matches published reference values', () => {
    expect(central(94)).toBeGreaterThan(0.15); // penalty spot, open play
    expect(central(94)).toBeLessThan(0.25);
    expect(central(101)).toBeGreaterThan(0.4); // six-yard box
    expect(central(101)).toBeLessThan(0.6);
    expect(central(75)).toBeGreaterThan(0.02); // 30 m
    expect(central(75)).toBeLessThan(0.04);
  });

  it('penalises tight angles, headers and returns the fixed penalty value', () => {
    expect(xgForShot({ start: { x: 100, y: 10 } })).toBeLessThan(xgForShot({ start: { x: 100, y: 34 } }));
    expect(xgForShot({ start: { x: 96, y: 34 }, bodyPart: 'head' })).toBeLessThan(xgForShot({ start: { x: 96, y: 34 } }));
    expect(xgForShot({ start: { x: 94, y: 34 }, playPattern: 'penalty' })).toBe(0.76);
  });
});
