import { isProgressive } from './progressive.js';

const pass = (sx: number, ex: number, success = true, type: 'pass' | 'carry' | 'shot' = 'pass') => ({
  type,
  success,
  start: { x: sx, y: 34 },
  end: { x: ex, y: 34 },
});

describe('isProgressive (Wyscout)', () => {
  it('requires 30 m within the own half', () => {
    expect(isProgressive(pass(10, 39))).toBe(false);
    expect(isProgressive(pass(10, 41))).toBe(true);
  });
  it('requires 15 m when crossing into the opponent half', () => {
    expect(isProgressive(pass(45, 59))).toBe(false);
    expect(isProgressive(pass(45, 61))).toBe(true);
  });
  it('requires 10 m within the opponent half', () => {
    expect(isProgressive(pass(60, 69))).toBe(false);
    expect(isProgressive(pass(60, 71))).toBe(true);
  });
  it('applies to carries but not failed actions, backward moves or shots', () => {
    expect(isProgressive(pass(60, 75, true, 'carry'))).toBe(true);
    expect(isProgressive(pass(60, 75, false))).toBe(false);
    expect(isProgressive(pass(75, 60))).toBe(false);
    expect(isProgressive(pass(80, 100, true, 'shot'))).toBe(false);
  });
  it('measures distance to the goal centre, not just x', () => {
    // wide-to-central pass gains a lot of goal distance with little x gain
    expect(isProgressive({ type: 'pass', success: true, start: { x: 90, y: 2 }, end: { x: 92, y: 30 } })).toBe(true);
  });
});
