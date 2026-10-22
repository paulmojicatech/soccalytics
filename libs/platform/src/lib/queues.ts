import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  AnalyticsJobPayload,
  QUEUES,
  jobChannel,
  type JobStreamEvent,
  type VisionJobPayload,
} from '@soccalytics/contracts';

export function redisConnection(url: string): ConnectionOptions {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null });
}

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export function createQueues(redisUrl: string) {
  const connection = redisConnection(redisUrl);
  const vision = new Queue<VisionJobPayload>(QUEUES.vision, { connection });
  const analytics = new Queue<AnalyticsJobPayload>(QUEUES.analytics, { connection });
  return {
    vision,
    analytics,
    /** jobId-derived BullMQ ids make enqueueing idempotent per stage. */
    enqueueVision: (p: VisionJobPayload) => vision.add('detect', p, { ...DEFAULT_JOB_OPTS, jobId: `${p.jobId}-vision` }),
    enqueueAnalytics: (p: AnalyticsJobPayload) =>
      analytics.add(p.task, AnalyticsJobPayload.parse(p), { ...DEFAULT_JOB_OPTS, jobId: `${p.jobId}-${p.task}` }),
    async close() {
      await Promise.all([vision.close(), analytics.close()]);
    },
  };
}
export type Queues = ReturnType<typeof createQueues>;

/** Job progress pub/sub (worker → api SSE). */
export function createJobEvents(redisUrl: string) {
  const pub = new Redis(redisUrl);
  return {
    publish: (e: JobStreamEvent) => pub.publish(jobChannel(e.jobId), JSON.stringify(e)),
    /** Returns an unsubscribe function. Uses a dedicated connection per subscriber. */
    subscribe(jobId: string, onEvent: (e: JobStreamEvent) => void) {
      const sub = new Redis(redisUrl);
      sub.on('error', () => undefined); // connection errors surface as a closed stream, never crash the process
      sub.subscribe(jobChannel(jobId)).catch(() => undefined);
      sub.on('message', (_ch, msg) => {
        try {
          onEvent(JSON.parse(msg) as JobStreamEvent);
        } catch {
          /* ignore malformed */
        }
      });
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        sub.quit().catch(() => sub.disconnect());
      };
    },
    ping: async () => (await pub.ping()) === 'PONG',
    close: () => pub.quit(),
  };
}
export type JobEvents = ReturnType<typeof createJobEvents>;
