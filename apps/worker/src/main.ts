import { startTelemetry } from '@soccalytics/platform';
const stopTelemetry = startTelemetry('soccalytics-worker');

const { Worker, UnrecoverableError } = await import('bullmq');
const { Redis } = await import('ioredis');
const { pino } = await import('pino');
const { AnalyticsJobPayload, JobStage, QUEUES } = await import('@soccalytics/contracts');
const { createDb, createRepositories } = await import('@soccalytics/db');
const { aiConfigFromEnv, createGateway } = await import('@soccalytics/ai');
const { createJobEvents, createQueues, createStorage, redisConnection } = await import('@soccalytics/platform');
const { loadConfig } = await import('./config.js');
const { createPipeline } = await import('./pipeline.js');

import type { JobStage as Stage, JobStatus, JobStreamEvent } from '@soccalytics/contracts';

const env = loadConfig();
const log = pino({ level: env.LOG_LEVEL, transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined });
const dbh = createDb(env.DATABASE_URL);
const repos = createRepositories(dbh.db);
const storage = createStorage(env);
const queues = createQueues(env.REDIS_URL);
const jobEvents = createJobEvents(env.REDIS_URL);
const ai = createGateway(aiConfigFromEnv(), (r) => repos.llmCalls.record(r));
const pipeline = createPipeline({ repos, storage, ai, log: (msg, extra) => log.info(extra ?? {}, msg) });

/** Persist stage state and fan it out to SSE subscribers. */
const reporter = (jobId: string) => async (stage: Stage, status: JobStatus, progress?: number, message?: string) => {
  const job = await repos.jobs.updateStage(jobId, stage, { status, progress, message });
  const st = job?.stages.find((s) => s.stage === stage);
  await jobEvents.publish({ jobId, stage, status, progress: st?.progress ?? progress ?? 0, message: message ?? null });
};

const worker = new Worker(
  QUEUES.analytics,
  async (job) => {
    const parsed = AnalyticsJobPayload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`invalid payload: ${parsed.error.message}`);
    const p = parsed.data;
    const report = reporter(p.jobId);
    log.info({ task: p.task, jobId: p.jobId, matchId: p.matchId, attempt: job.attemptsMade + 1 }, 'processing');

    switch (p.task) {
      case 'simulate':
        await pipeline.simulate(p.matchId, p.seed, report);
        await queues.enqueueAnalytics({ task: 'metrics', jobId: p.jobId, matchId: p.matchId });
        break;
      case 'events':
        await pipeline.eventsFromTracking(p.matchId, p.trackingKey, report);
        await queues.enqueueAnalytics({ task: 'metrics', jobId: p.jobId, matchId: p.matchId });
        break;
      case 'metrics':
        await pipeline.metrics(p.matchId, report);
        await queues.enqueueAnalytics({ task: 'report', jobId: p.jobId, matchId: p.matchId });
        break;
      case 'report':
        await pipeline.reports(p.matchId, report, env.AUTO_REPORTS);
        break;
    }
  },
  { connection: redisConnection(env.REDIS_URL), concurrency: env.WORKER_CONCURRENCY, lockDuration: 120_000 },
);

const STAGE_OF_TASK: Record<string, Stage> = { simulate: 'events', events: 'events', metrics: 'metrics', report: 'report' };

worker.on('failed', async (job, err) => {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
  log.error({ err, jobId: job.data.jobId, task: job.data.task, final }, 'job failed');
  if (!final) return;
  const stage = STAGE_OF_TASK[job.data.task] ?? 'events';
  await reporter(job.data.jobId)(stage, 'failed', undefined, err.message).catch(() => undefined);
  await repos.matches.update(job.data.matchId, { status: 'failed' }).catch(() => undefined);
});

/**
 * The Python vision worker only publishes progress; mirror its stage updates
 * (ingest/detect/track) into Postgres so job state survives page reloads.
 */
const VISION_STAGES = new Set<Stage>(['ingest', 'detect', 'track']);
const mirror = new Redis(env.REDIS_URL);
await mirror.psubscribe('soccalytics:job:*');
mirror.on('pmessage', async (_pattern, _channel, message) => {
  try {
    const e = JSON.parse(message) as JobStreamEvent;
    if (!JobStage.safeParse(e.stage).success || !VISION_STAGES.has(e.stage)) return;
    await repos.jobs.updateStage(e.jobId, e.stage, { status: e.status, progress: e.progress, message: e.message });
    if (e.status === 'failed') {
      const job = await repos.jobs.get(e.jobId);
      if (job) await repos.matches.update(job.matchId, { status: 'failed' });
    }
  } catch (err) {
    log.warn({ err }, 'failed to mirror vision progress');
  }
});

log.info({ queue: QUEUES.analytics, concurrency: env.WORKER_CONCURRENCY, ai: ai.online ? ai.model : 'offline' }, 'worker ready');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'draining');
    await worker.close();
    await Promise.allSettled([mirror.quit(), queues.close(), jobEvents.close(), dbh.close()]);
    await stopTelemetry();
    process.exit(0);
  });
}
