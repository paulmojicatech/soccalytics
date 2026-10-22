import { z } from 'zod';
import { Id } from './common.js';
import { Position } from './domain.js';
import { PlayerMetricKey } from './metrics.js';

/*
 * Schemas the LLM must fill via structured outputs. Keep them free of
 * numeric bounds/regex — structured outputs enforce shape, and we validate
 * semantics (grounding) separately in @soccalytics/ai.
 */

/** A claim the model makes, tied to a metric it was given. */
export const GroundedClaim = z.object({
  text: z.string().describe('One-sentence insight written for a coach.'),
  evidence: z
    .array(
      z.object({
        subject: z.string().describe('playerId or teamId the metric belongs to'),
        metric: z.string().describe('Exact metric key from the provided context'),
        value: z.number().describe('Exact value from the provided context'),
      }),
    )
    .describe('Metrics from the context that support the claim. Never invent values.'),
});
export type GroundedClaim = z.infer<typeof GroundedClaim>;

export const MatchReport = z.object({
  headline: z.string(),
  summary: z.string().describe('3–5 sentence narrative of how the match was decided.'),
  tacticalBreakdown: z.object({
    inPossession: z.array(GroundedClaim),
    outOfPossession: z.array(GroundedClaim),
    transitions: z.array(GroundedClaim),
  }),
  standoutPlayers: z.array(
    z.object({ playerId: z.string(), reason: GroundedClaim }),
  ),
  concerns: z.array(GroundedClaim),
  trainingFocus: z
    .array(z.object({ theme: z.string(), drill: z.string(), rationale: z.string() }))
    .describe('2–4 concrete training priorities for the coach of the focus team.'),
});
export type MatchReport = z.infer<typeof MatchReport>;

export const PlayerEvaluation = z.object({
  summary: z.string(),
  strengths: z.array(GroundedClaim),
  developmentAreas: z.array(GroundedClaim),
  playerComparison: z
    .string()
    .describe('Stylistic comparison to the provided similar players only; empty if none given.'),
  developmentPlan: z.array(
    z.object({ goal: z.string(), kpi: z.string(), timeframeWeeks: z.number() }),
  ),
  scoutingVerdict: z.enum(['monitor', 'shortlist', 'priority_target', 'not_a_fit']),
});
export type PlayerEvaluation = z.infer<typeof PlayerEvaluation>;

/** Natural-language scouting query compiled into a structured filter. */
export const ScoutFilter = z.object({
  positions: z.array(Position).describe('Empty array means any position.'),
  maxAge: z.number().nullable(),
  minAge: z.number().nullable(),
  minMinutes: z.number().nullable(),
  foot: z.enum(['left', 'right', 'both']).nullable(),
  /** Per-90 percentile thresholds against position peers (0–100). */
  metricThresholds: z.array(z.object({ metric: PlayerMetricKey, minPercentile: z.number() })),
  /** Metrics to rank by, most important first. */
  rankBy: z.array(PlayerMetricKey),
  /** Optional reference player to find stylistic matches for. */
  similarToPlayerName: z.string().nullable(),
  interpretation: z.string().describe('One sentence restating what the scout asked for.'),
});
export type ScoutFilter = z.infer<typeof ScoutFilter>;

export const ScoutResult = z.object({
  playerId: Id,
  name: z.string(),
  teamName: z.string(),
  position: Position,
  age: z.number(),
  minutes: z.number(),
  score: z.number(),
  highlights: z.array(z.object({ metric: PlayerMetricKey, per90: z.number(), percentile: z.number() })),
});
export type ScoutResult = z.infer<typeof ScoutResult>;

export const ScoutSearchResponse = z.object({
  filter: ScoutFilter,
  results: z.array(ScoutResult),
});
export type ScoutSearchResponse = z.infer<typeof ScoutSearchResponse>;

/** Persisted AI artefact with provenance for auditability. */
export const AiArtifactMeta = z.object({
  model: z.string(),
  promptVersion: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  latencyMs: z.number(),
  grounding: z.object({
    claims: z.number(),
    verified: z.number(),
    /** Evidence entries that did not match the context. */
    violations: z.array(z.string()),
  }),
  generatedAt: z.string(),
});
export type AiArtifactMeta = z.infer<typeof AiArtifactMeta>;

export const StoredMatchReport = z.object({ matchId: Id, teamId: Id, report: MatchReport, meta: AiArtifactMeta });
export type StoredMatchReport = z.infer<typeof StoredMatchReport>;

export const StoredPlayerEvaluation = z.object({ playerId: Id, evaluation: PlayerEvaluation, meta: AiArtifactMeta });
export type StoredPlayerEvaluation = z.infer<typeof StoredPlayerEvaluation>;

// ── Analyst assistant (streaming agent) ──

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AssistantRequest = z.object({
  messages: z.array(ChatMessage).min(1),
  /** Page context so the assistant knows what the user is looking at. */
  context: z
    .object({ matchId: Id.optional(), playerId: Id.optional(), teamId: Id.optional() })
    .default({}),
});
export type AssistantRequest = z.infer<typeof AssistantRequest>;

/** SSE events streamed from POST /v1/assistant/chat. */
export const AssistantStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('tool'), name: z.string(), status: z.enum(['started', 'finished']) }),
  z.object({ type: z.literal('done'), usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }) }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AssistantStreamEvent = z.infer<typeof AssistantStreamEvent>;
