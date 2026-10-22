import { hashString, Rng } from './rng.js';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(new Rng(8).next()).not.toBe(xs[0]);
  });

  it('produces sane distributions', () => {
    const r = new Rng(1);
    const n = 20000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const v = r.normal(0, 1);
      s += v;
      s2 += v * v;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.05);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
    for (let i = 0; i < 1000; i++) {
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
    }
  });

  it('forks independent but reproducible streams', () => {
    expect(new Rng(3).fork('x').next()).toBe(new Rng(3).fork('x').next());
    expect(new Rng(3).fork('x').next()).not.toBe(new Rng(3).fork('y').next());
    expect(hashString('abc')).toBe(hashString('abc'));
  });
});
