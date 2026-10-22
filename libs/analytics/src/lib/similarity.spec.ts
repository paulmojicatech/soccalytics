import type { PlayerProfile } from '@soccalytics/contracts';
import { emptyMetrics } from './match-stats.js';
import { cohortStats, cosineSimilarity, profileVector, VECTOR_DIM, VECTOR_KEYS } from './similarity.js';

const prof = (id: string, over: Partial<PlayerProfile['per90']>): PlayerProfile => ({
  playerId: id,
  position: 'CM',
  matches: 3,
  minutes: 270,
  per90: { ...emptyMetrics(), ...over },
  avgRating: 6.5,
});

describe('similarity', () => {
  it('has a fixed dimension without minutes', () => {
    expect(VECTOR_DIM).toBe(VECTOR_KEYS.length);
    expect(VECTOR_KEYS).not.toContain('minutes');
    expect(profileVector(prof('a', {}))).toHaveLength(VECTOR_DIM);
  });

  it('cosine similarity behaves', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it('stylistically similar profiles score higher with cohort standardisation', () => {
    const a = prof('a', { passes: 70, key_passes: 3, tackles_won: 0.5 });
    const b = prof('b', { passes: 65, key_passes: 2.6, tackles_won: 0.7 });
    const c = prof('c', { passes: 25, key_passes: 0.2, tackles_won: 4 });
    const stats = cohortStats([a, b, c]);
    const va = profileVector(a, stats);
    expect(cosineSimilarity(va, profileVector(b, stats))).toBeGreaterThan(cosineSimilarity(va, profileVector(c, stats)));
  });
});
