import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Position, type AssistantRequest, type AssistantStreamEvent } from '@soccalytics/contracts';
import type { Gateway } from './gateway.js';
import { PROMPTS } from './prompts/registry.js';
import { withSpan } from './telemetry.js';

/**
 * Read-only data access the assistant may use. Implemented by the API on top
 * of the repositories; each handler returns a compact JSON-serialisable
 * summary (handlers paginate/limit themselves — results are never truncated).
 */
export interface AnalystTools {
  searchPlayers(input: { name?: string; position?: Position; teamName?: string; limit: number }): Promise<unknown>;
  getPlayer(input: { playerId: string }): Promise<unknown>;
  comparePlayers(input: { playerIds: string[] }): Promise<unknown>;
  listMatches(input: { teamName?: string; limit: number }): Promise<unknown>;
  getMatch(input: { matchId: string }): Promise<unknown>;
  scoutSearch(input: { query: string }): Promise<unknown>;
}

const TOOL_LABELS: Record<string, string> = {
  search_players: 'Searching players',
  get_player: 'Reading player profile',
  compare_players: 'Comparing players',
  list_matches: 'Listing matches',
  get_match: 'Reading match analysis',
  scout_search: 'Running scouting search',
};
export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

function buildTools(tools: AnalystTools, emit: (e: AssistantStreamEvent) => void) {
  const wrap =
    <I>(name: string, fn: (input: I) => Promise<unknown>) =>
    async (input: I) => {
      try {
        return JSON.stringify(await fn(input));
      } finally {
        emit({ type: 'tool', name, status: 'finished' });
      }
    };

  return [
    betaZodTool({
      name: 'search_players',
      description: 'Find players by (partial) name, position and/or team name. Returns ids, team, age, minutes and average rating.',
      inputSchema: z.object({
        name: z.string().optional(),
        position: Position.optional(),
        teamName: z.string().optional(),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      run: wrap('search_players', tools.searchPlayers),
    }),
    betaZodTool({
      name: 'get_player',
      description: 'Per-90 profile, percentile benchmarks vs position peers, rating trend and similar players for one player id.',
      inputSchema: z.object({ playerId: z.string() }),
      run: wrap('get_player', tools.getPlayer),
    }),
    betaZodTool({
      name: 'compare_players',
      description: 'Side-by-side per-90 metrics and percentiles for 2–4 player ids.',
      inputSchema: z.object({ playerIds: z.array(z.string()).min(2).max(4) }),
      run: wrap('compare_players', tools.comparePlayers),
    }),
    betaZodTool({
      name: 'list_matches',
      description: 'Recent analysed matches, optionally for one team, with scores and xG.',
      inputSchema: z.object({ teamName: z.string().optional(), limit: z.number().int().min(1).max(20).default(10) }),
      run: wrap('list_matches', tools.listMatches),
    }),
    betaZodTool({
      name: 'get_match',
      description: 'Team stats (xG, possession, PPDA, field tilt…) and top-rated players for one match id.',
      inputSchema: z.object({ matchId: z.string() }),
      run: wrap('get_match', tools.getMatch),
    }),
    betaZodTool({
      name: 'scout_search',
      description: 'Natural-language scouting search across all players, e.g. "left-footed full-backs under 21 who press".',
      inputSchema: z.object({ query: z.string() }),
      run: wrap('scout_search', tools.scoutSearch),
    }),
  ];
}

/**
 * Streams an analyst-assistant turn. Uses the SDK tool runner (it owns the
 * tool loop) with streaming so text deltas reach the browser immediately.
 */
export async function runAssistant(
  gateway: Gateway,
  req: AssistantRequest,
  tools: AnalystTools,
  emit: (e: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const prompt = PROMPTS.assistant;
  if (!gateway.client) {
    emit({
      type: 'text',
      delta:
        'The analyst assistant needs the Claude API. Set `ANTHROPIC_API_KEY` in `.env` and restart the API. Dashboards, reports and scouting keep working in offline mode.',
    });
    emit({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
    return;
  }

  const ctx = req.context;
  const pageContext = [
    ctx.matchId && `matchId=${ctx.matchId}`,
    ctx.playerId && `playerId=${ctx.playerId}`,
    ctx.teamId && `teamId=${ctx.teamId}`,
  ].filter(Boolean);

  const messages: BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  if (pageContext.length) {
    // Operator-provided page context as a mid-conversation system message keeps
    // the cached prefix (system + tools + history) intact.
    messages.push({ role: 'system', content: `The user is currently viewing: ${pageContext.join(', ')}.` });
  }

  const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
  const started = Date.now();
  let stopReason: string | null = null;
  let error: string | null = null;

  await withSpan('ai.assistant', { 'ai.model': gateway.model }, async () => {
    try {
      const runner = gateway.client!.beta.messages.toolRunner(
        {
          model: gateway.model,
          max_tokens: prompt.maxTokens,
          max_iterations: 8,
          stream: true,
          thinking: { type: 'adaptive' },
          output_config: { effort: prompt.effort },
          system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
          tools: buildTools(tools, emit),
          messages,
        },
        { signal },
      );

      for await (const stream of runner) {
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        stream.on('streamEvent', (event) => {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            emit({ type: 'tool', name: event.content_block.name, status: 'started' });
          }
        });
        const message = await stream.finalMessage();
        stopReason = message.stop_reason;
        usage.inputTokens += message.usage.input_tokens;
        usage.outputTokens += message.usage.output_tokens;
        usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
        if (message.stop_reason === 'refusal') {
          emit({ type: 'text', delta: '\n\n_I can’t help with that request._' });
        }
      }
      emit({ type: 'done', usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message: 'The assistant hit an error. Please try again.' });
    } finally {
      await Promise.resolve(
        gateway.sink({
          id: randomUUID(),
          task: prompt.id,
          model: gateway.model,
          promptVersion: prompt.version,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
          latencyMs: Date.now() - started,
          stopReason,
          ok: error === null,
          error,
          subjectId: ctx.matchId ?? ctx.playerId ?? null,
        }),
      ).catch(() => undefined);
    }
  });
}
