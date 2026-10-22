import { z } from 'zod';

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

export const AiConfig = z.object({
  /** When absent the gateway runs in offline mode with deterministic fallbacks. */
  apiKey: z.string().min(1).optional(),
  model: z.string().default('claude-opus-5-5'),
  /** Default effort; tasks may override (e.g. query compilation runs at `low`). */
  effort: Effort.default('medium'),
  maxRetries: z.number().int().default(3),
  timeoutMs: z.number().int().default(120_000),
});
export type AiConfig = z.infer<typeof AiConfig>;

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return AiConfig.parse({
    apiKey: env['ANTHROPIC_API_KEY'] || undefined,
    model: env['AI_MODEL'] || undefined,
    effort: env['AI_EFFORT'] || undefined,
  });
}
