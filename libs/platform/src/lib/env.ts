import { z } from 'zod';

/** Validated environment shared by api + worker. Fails fast on boot. */
export const PlatformEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('soccalytics'),
  S3_ACCESS_KEY_ID: z.string().default('soccalytics'),
  S3_SECRET_ACCESS_KEY: z.string().default('soccalytics-secret'),
  /** Public endpoint used in presigned URLs handed to browsers (defaults to S3_ENDPOINT). */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});
export type PlatformEnv = z.infer<typeof PlatformEnv>;

export function parseEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const res = schema.safeParse(env);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}\n(copy .env.example to .env)`);
  }
  return res.data;
}
