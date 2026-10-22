import { z } from 'zod';
import { PlatformEnv, parseEnv } from '@soccalytics/platform';

export const ApiEnv = PlatformEnv.extend({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(300),
  /** Stricter limit for routes that call the LLM. */
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(20),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export const loadConfig = () => parseEnv(ApiEnv);
