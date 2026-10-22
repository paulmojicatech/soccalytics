/**
 * AI evals: `pnpm nx run ai:eval` (online if ANTHROPIC_API_KEY is set, else offline templates).
 *
 * Checks per task:
 *   - schema validity (structured outputs should make this 100%)
 *   - grounding: ≥ 90% of claims verified, cited values match the context
 *   - task-specific content assertions on golden fixtures
 * Writes dist/evals/<timestamp>.json so prompt versions can be compared over time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { MatchReport, PlayerEvaluation } from '@soccalytics/contracts';
import { aiConfigFromEnv } from '../lib/config.js';
import { createGateway } from '../lib/gateway.js';
import { compileScoutQuery, generateMatchReport, generatePlayerEvaluation } from '../lib/tasks.js';
import type { LlmCallRecord } from '../lib/telemetry.js';
import { MATCH_FIXTURE, PLAYER_FIXTURE, SCOUT_FIXTURES } from './fixtures.js';

interface Check { name: string; pass: boolean; detail?: string }
const results: { task: string; checks: Check[] }[] = [];
const calls: LlmCallRecord[] = [];
const gateway = createGateway(aiConfigFromEnv(), (r) => void calls.push(r));
const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, detail });

console.log(`Running evals (${gateway.online ? `online: ${gateway.model}` : 'offline templates'})\n`);

{
  const { report, meta } = await generateMatchReport(gateway, MATCH_FIXTURE);
  const rate = meta.grounding.verified / Math.max(meta.grounding.claims, 1);
  const text = JSON.stringify(report).toLowerCase();
  results.push({
    task: 'match_report',
    checks: [
      check('schema valid', MatchReport.safeParse(report).success),
      check('grounding ≥ 90%', rate >= 0.9, `${meta.grounding.verified}/${meta.grounding.claims}; ${meta.grounding.violations.slice(0, 3).join(' | ')}`),
      check('2–4 training priorities', report.trainingFocus.length >= 2 && report.trainingFocus.length <= 4),
      check('notes xG vs result (finishing variance)', /xg|expected goals|finishing|chance/.test(text)),
      check('standouts are real players', report.standoutPlayers.every((s) => MATCH_FIXTURE.playerStats.some((p) => p.playerId === s.playerId))),
    ],
  });
}

{
  const { evaluation, meta } = await generatePlayerEvaluation(gateway, PLAYER_FIXTURE);
  const rate = meta.grounding.verified / Math.max(meta.grounding.claims, 1);
  results.push({
    task: 'player_evaluation',
    checks: [
      check('schema valid', PlayerEvaluation.safeParse(evaluation).success),
      check('grounding ≥ 90%', rate >= 0.9, `${meta.grounding.verified}/${meta.grounding.claims}; ${meta.grounding.violations.slice(0, 3).join(' | ')}`),
      check('pressing identified as strength', JSON.stringify(evaluation.strengths).includes('pressure')),
      check('comparison only uses provided players', evaluation.playerComparison === '' || evaluation.playerComparison.includes('Lindqvist')),
      check('verdict is not not_a_fit', evaluation.scoutingVerdict !== 'not_a_fit'),
    ],
  });
}

for (const fx of SCOUT_FIXTURES) {
  const f = await compileScoutQuery(gateway, fx.query);
  const checks: Check[] = [];
  if (fx.expect.positions) checks.push(check('positions', fx.expect.positions.every((p) => f.positions.includes(p as never)), f.positions.join(',')));
  if (fx.expect.maxAgeAtMost !== undefined) checks.push(check('max age', f.maxAge !== null && f.maxAge <= fx.expect.maxAgeAtMost, String(f.maxAge)));
  if (fx.expect.foot) checks.push(check('foot', f.foot === fx.expect.foot, String(f.foot)));
  if (fx.expect.rankByAny) checks.push(check('rank metrics', f.rankBy.some((m) => fx.expect.rankByAny!.includes(m)), f.rankBy.join(',')));
  results.push({ task: `scout_query: "${fx.query}"`, checks });
}

let failed = 0;
for (const r of results) {
  console.log(r.task);
  for (const c of r.checks) {
    if (!c.pass) failed++;
    console.log(`  ${c.pass ? '✔' : '✘'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
}
const tokens = calls.reduce((a, c) => ({ in: a.in + c.inputTokens, out: a.out + c.outputTokens, cache: a.cache + c.cacheReadTokens }), { in: 0, out: 0, cache: 0 });
console.log(`\n${failed === 0 ? 'PASS' : `FAIL (${failed} checks)`} · ${calls.length} LLM calls · tokens in ${tokens.in} / out ${tokens.out} / cache-read ${tokens.cache}`);

mkdirSync('dist/evals', { recursive: true });
writeFileSync(`dist/evals/${Date.now()}.json`, JSON.stringify({ model: gateway.online ? gateway.model : 'offline', results, calls }, null, 2));
process.exit(failed ? 1 : 0);
