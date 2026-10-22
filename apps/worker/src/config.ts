import { z } from 'zod';
import { PlatformEnv, parseEnv } from '@soccalytics/platform';

export const WorkerEnv = PlatformEnv.extend({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** Generate AI match reports automatically at the end of the pipeline. */
  AUTO_REPORTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;
export const loadConfig = () => parseEnv(WorkerEnv);
