import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AiConfig } from './config.js';
import { AiError } from './errors.js';
import type { PromptDef } from './prompts/registry.js';
import { withSpan, type LlmCallRecord, type UsageSink } from './telemetry.js';

/** Server-side refusal fallback: the API re-runs a declined request on a suitable model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface StructuredResult<T> {
  data: T;
  record: LlmCallRecord;
}

export interface Gateway {
  readonly online: boolean;
  readonly model: string;
  readonly client: Anthropic | null;
  readonly sink: UsageSink;
  structured<S extends z.ZodType>(args: {
    task: string;
    prompt: PromptDef;
    schema: S;
    /** Volatile per-request content (context JSON + instruction). */
    userContent: string;
    subjectId?: string;
  }): Promise<StructuredResult<z.infer<S>>>;
}

/**
 * The only place that talks to the Claude API for single-shot tasks.
 * Centralises: model + effort selection, prompt caching, structured outputs,
 * refusal/truncation handling, retries/timeouts and usage telemetry.
 */
export function createGateway(config: AiConfig, sink: UsageSink = () => undefined): Gateway {
  const client = config.apiKey
    ? new Anthropic({ apiKey: config.apiKey, maxRetries: config.maxRetries, timeout: config.timeoutMs })
    : null;

  return {
    online: client !== null,
    model: config.model,
    client,
    sink,
    async structured({ task, prompt, schema, userContent, subjectId }) {
      if (!client) throw new AiError('ANTHROPIC_API_KEY not configured', 'unavailable');

      return withSpan(`ai.${task}`, { 'ai.model': config.model, 'ai.prompt_version': prompt.version }, async (span) => {
        const started = Date.now();
        const record: LlmCallRecord = {
          id: randomUUID(),
          task,
          model: config.model,
          promptVersion: prompt.version,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          latencyMs: 0,
          stopReason: null,
          ok: false,
          error: null,
          subjectId: subjectId ?? null,
        };
        try {
          const response = await client.beta.messages.parse({
            model: config.model,
            max_tokens: prompt.maxTokens,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: prompt.effort, format: betaZodOutputFormat(schema) },
            // Stable system prompt (instructions + glossary) is cached; the
            // per-request context lives in the user turn after the breakpoint.
            system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: userContent }],
          });

          record.model = response.model;
          record.stopReason = response.stop_reason;
          record.inputTokens = response.usage.input_tokens;
          record.outputTokens = response.usage.output_tokens;
          record.cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
          record.cacheWriteTokens = response.usage.cache_creation_input_tokens ?? 0;
          span.setAttributes({
            'ai.input_tokens': record.inputTokens,
            'ai.output_tokens': record.outputTokens,
            'ai.cache_read_tokens': record.cacheReadTokens,
          });

          if (response.stop_reason === 'refusal') {
            throw new AiError('The model declined this request', 'refusal', response.stop_details);
          }
          if (response.stop_reason === 'max_tokens') {
            throw new AiError('Model output was truncated', 'truncated');
          }
          if (response.parsed_output == null) {
            throw new AiError('Model output did not match the schema', 'invalid_output');
          }
          record.ok = true;
          return { data: response.parsed_output as z.infer<typeof schema>, record };
        } catch (err) {
          record.error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          record.latencyMs = Date.now() - started;
          await Promise.resolve(sink(record)).catch(() => undefined);
        }
      });
    },
  };
}
