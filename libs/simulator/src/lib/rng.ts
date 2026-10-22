/**
 * Seeded pseudo-random number generation (no dependencies).
 * mulberry32: tiny, fast, 32-bit state, good enough statistical quality for
 * simulation work, and fully deterministic across platforms.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string (for deriving sub-seeds from labels). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private readonly gen: () => number;
  private spare: number | null = null;

  constructor(readonly seed: number) {
    this.gen = mulberry32(seed);
  }

  /** Uniform [0, 1). */
  next(): number {
    return this.gen();
  }

  /** Uniform [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.gen();
  }

  /** Integer uniform in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.gen() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.gen() < p;
  }

  /** Gaussian via Box–Muller. */
  normal(mean = 0, sd = 1): number {
    if (this.spare != null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    while (u === 0) u = this.gen();
    const v = this.gen();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  pick<T>(xs: readonly T[]): T {
    if (!xs.length) throw new Error('pick from empty array');
    return xs[Math.floor(this.gen() * xs.length)] as T;
  }

  /** Index sampled proportionally to non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return Math.floor(this.gen() * weights.length);
    let r = this.gen() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i] as number);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen() * (i + 1));
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  }

  /** Independent child stream derived from this seed and a label. */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ Math.imul(this.seed >>> 0, 0x9e3779b1)) >>> 0);
  }
}
