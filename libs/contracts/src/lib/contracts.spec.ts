import { describe, expect, it } from 'vitest';
import { MatchEvent, PlayerMetricKey, METRIC_META, AnalyticsJobPayload } from '../index.js';

describe('contracts', () => {
  it('applies event defaults', () => {
    const e = MatchEvent.parse({
      id: 'e1', matchId: 'm1', teamId: 't1', playerId: 'p1', period: 1, t: 12.5,
      type: 'pass', start: { x: 30, y: 30 }, end: { x: 50, y: 40 }, success: true,
    });
    expect(e.xg).toBeNull();
    expect(e.bodyPart).toBe('foot');
    expect(e.confidence).toBe(1);
  });

  it('has display metadata for every metric key', () => {
    for (const key of PlayerMetricKey.options) expect(METRIC_META[key]).toBeDefined();
  });

  it('discriminates analytics job payloads', () => {
    expect(() => AnalyticsJobPayload.parse({ task: 'metrics', jobId: 'j', matchId: 'm' })).not.toThrow();
    expect(() => AnalyticsJobPayload.parse({ task: 'nope', jobId: 'j', matchId: 'm' })).toThrow();
  });
});
