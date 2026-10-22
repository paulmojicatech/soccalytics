import { MatchReport, PlayerEvaluation, ScoutFilter, type AiArtifactMeta } from '@soccalytics/contracts';
import { buildMatchContext, buildPlayerContext, type MatchContextInput, type PlayerContextInput } from './context.js';
import { fallbackMatchReport, fallbackPlayerEvaluation, fallbackScoutFilter } from './fallback.js';
import type { Gateway } from './gateway.js';
import type { LlmCallRecord } from './telemetry.js';
import { verifyClaims } from './grounding.js';
import { PROMPTS, type PromptDef } from './prompts/registry.js';

function meta(
  prompt: PromptDef,
  record: LlmCallRecord | null,
  started: number,
  grounding: AiArtifactMeta['grounding'],
): AiArtifactMeta {
  return {
    model: record?.model ?? 'offline-template',
    promptVersion: record ? prompt.version : `${prompt.version}+offline`,
    inputTokens: record?.inputTokens ?? 0,
    outputTokens: record?.outputTokens ?? 0,
    cacheReadTokens: record?.cacheReadTokens ?? 0,
    latencyMs: record?.latencyMs ?? Date.now() - started,
    grounding,
    generatedAt: new Date().toISOString(),
  };
}

/** Context JSON goes last (after the cached system prompt), wrapped in tags. */
const userTurn = (instruction: string, context: unknown) =>
  `<context>\n${JSON.stringify(context)}\n</context>\n\n${instruction}`;

export async function generateMatchReport(gateway: Gateway, input: MatchContextInput) {
  const started = Date.now();
  const { context, facts, subjects } = buildMatchContext(input);
  const prompt = PROMPTS.matchReport;

  let report: MatchReport;
  let record: LlmCallRecord | null = null;
  if (gateway.online) {
    const res = await gateway.structured({
      task: prompt.id,
      prompt,
      schema: MatchReport,
      subjectId: input.match.id,
      userContent: userTurn(`Write the post-match report for ${context.match.focusTeamName}.`, context),
    });
    report = res.data;
    record = res.record;
  } else {
    report = fallbackMatchReport(context);
  }

  const claims = [
    ...report.tacticalBreakdown.inPossession,
    ...report.tacticalBreakdown.outOfPossession,
    ...report.tacticalBreakdown.transitions,
    ...report.standoutPlayers.map((s) => s.reason),
    ...report.concerns,
  ];
  const unknownPlayers = report.standoutPlayers
    .filter((s) => !subjects.has(s.playerId))
    .map((s) => `Unknown standout player id ${s.playerId}`);
  const grounding = verifyClaims(claims, facts, unknownPlayers);
  return { report, meta: meta(prompt, record, started, grounding) };
}

export async function generatePlayerEvaluation(gateway: Gateway, input: PlayerContextInput) {
  const started = Date.now();
  const { context, facts } = buildPlayerContext(input);
  const prompt = PROMPTS.playerEvaluation;

  let evaluation: PlayerEvaluation;
  let record: LlmCallRecord | null = null;
  if (gateway.online) {
    const res = await gateway.structured({
      task: prompt.id,
      prompt,
      schema: PlayerEvaluation,
      subjectId: input.player.id,
      userContent: userTurn(`Evaluate ${input.player.name}.`, context),
    });
    evaluation = res.data;
    record = res.record;
  } else {
    evaluation = fallbackPlayerEvaluation(context);
  }
  const grounding = verifyClaims([...evaluation.strengths, ...evaluation.developmentAreas], facts);
  return { evaluation, meta: meta(prompt, record, started, grounding) };
}

export async function compileScoutQuery(gateway: Gateway, query: string): Promise<ScoutFilter> {
  if (!gateway.online) return fallbackScoutFilter(query);
  const prompt = PROMPTS.scoutQuery;
  const res = await gateway.structured({
    task: prompt.id,
    prompt,
    schema: ScoutFilter,
    // The query is untrusted user text: keep it delimited and treat as data.
    userContent: `<scout_request>\n${query}\n</scout_request>\n\nCompile this request into a filter.`,
  });
  return res.data;
}
