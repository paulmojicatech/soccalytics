import { describe, expect, it } from 'vitest';
import { MatchReport, PlayerEvaluation } from '@soccalytics/contracts';
import { createGateway } from './gateway.js';
import { compileScoutQuery, generateMatchReport, generatePlayerEvaluation } from './tasks.js';
import { MATCH_FIXTURE, PLAYER_FIXTURE } from '../evals/fixtures.js';

// No API key ⇒ offline templates: verifies the full pipeline shape deterministically.
const offline = createGateway({ model: 'claude-opus-5-5', effort: 'medium', maxRetries: 0, timeoutMs: 1000 });

describe('offline tasks', () => {
  it('produces a schema-valid, fully grounded match report', async () => {
    const { report, meta } = await generateMatchReport(offline, MATCH_FIXTURE);
    expect(MatchReport.safeParse(report).success).toBe(true);
    expect(meta.grounding.violations).toEqual([]);
    expect(meta.grounding.verified).toBe(meta.grounding.claims);
    expect(meta.model).toBe('offline-template');
  });

  it('produces a grounded player evaluation', async () => {
    const { evaluation, meta } = await generatePlayerEvaluation(offline, PLAYER_FIXTURE);
    expect(PlayerEvaluation.safeParse(evaluation).success).toBe(true);
    expect(meta.grounding.violations).toEqual([]);
    expect(evaluation.strengths.length).toBeGreaterThan(0);
  });

  it('compiles a scouting query by keywords', async () => {
    const f = await compileScoutQuery(offline, 'Left-footed full-backs under 21 who press hard');
    expect(f.positions).toContain('FB');
    expect(f.maxAge).toBe(20);
    expect(f.foot).toBe('left');
    expect(f.rankBy).toContain('pressures');
  });
});
