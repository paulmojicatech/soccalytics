import { describe, expect, it } from 'vitest';
import { factKey } from './context.js';
import { approxEqual, verifyClaims } from './grounding.js';

describe('verifyClaims', () => {
  const facts = new Map([
    [factKey('p1', 'xg'), 0.87],
    [factKey('t1', 'ppda'), 8.4],
  ]);

  it('verifies exact and rounded citations', () => {
    const g = verifyClaims(
      [
        { text: 'a', evidence: [{ subject: 'p1', metric: 'xg', value: 0.87 }] },
        { text: 'b', evidence: [{ subject: 't1', metric: 'ppda', value: 8.4 }] },
      ],
      facts,
    );
    expect(g).toEqual({ claims: 2, verified: 2, violations: [] });
  });

  it('flags invented metrics, wrong values and evidence-free claims', () => {
    const g = verifyClaims(
      [
        { text: 'x', evidence: [{ subject: 'p1', metric: 'goals', value: 3 }] },
        { text: 'y', evidence: [{ subject: 't1', metric: 'ppda', value: 12 }] },
        { text: 'z', evidence: [] },
      ],
      facts,
    );
    expect(g.verified).toBe(0);
    expect(g.violations).toHaveLength(3);
  });

  it('tolerates small rounding only', () => {
    expect(approxEqual(0.87, 0.9)).toBe(true);
    expect(approxEqual(84.3, 84)).toBe(true);
    expect(approxEqual(8.4, 9.4)).toBe(false);
  });
});
