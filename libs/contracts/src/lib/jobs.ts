import { z } from 'zod';
import { Id, Timestamp } from './common.js';

/**
 * Video → insight pipeline. Each stage is an idempotent BullMQ job; the
 * next stage is enqueued only when the previous one has persisted its output.
 *
 *  ingest ─▶ detect ─▶ track ─▶ events ─▶ metrics ─▶ report
 *  (S3)     (YOLO)   (ByteTrack (possession  (analytics  (Claude)
 *                     + homography) model)    engine)
 *
 * Simulation jobs skip ingest/detect/track and synthesise tracking + events.
 */
export const JobStage = z.enum(['ingest', 'detect', 'track', 'events', 'metrics', 'report']);
export type JobStage = z.infer<typeof JobStage>;

export const JobStatus = z.enum(['queued', 'running', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatus>;

export const StageState = z.object({
  stage: JobStage,
  status: JobStatus,
  progress: z.number().min(0).max(1),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  message: z.string().nullable(),
});
export type StageState = z.infer<typeof StageState>;

export const ProcessingJob = z.object({
  id: Id,
  matchId: Id,
  kind: z.enum(['video', 'simulation']),
  status: JobStatus,
  stages: z.array(StageState),
  error: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ProcessingJob = z.infer<typeof ProcessingJob>;

/** Server-sent event payload for GET /v1/jobs/:id/stream. */
export const JobStreamEvent = z.object({
  jobId: Id,
  stage: JobStage,
  status: JobStatus,
  progress: z.number(),
  message: z.string().nullable(),
});
export type JobStreamEvent = z.infer<typeof JobStreamEvent>;

// ── Queue contracts (shared by api, worker and the Python vision worker) ──

export const QUEUES = {
  /** Consumed by apps/vision-worker (Python): detect + track. */
  vision: 'soccalytics.vision',
  /** Consumed by apps/worker: events, metrics, report, simulation. */
  analytics: 'soccalytics.analytics',
} as const;

export const VisionJobPayload = z.object({
  jobId: Id,
  matchId: Id,
  videoKey: z.string(),
  homeTeamId: Id,
  awayTeamId: Id,
  /** Optional 4-point pitch calibration (pixel → pitch metres). */
  calibration: z
    .array(z.object({ px: z.number(), py: z.number(), x: z.number(), y: z.number() }))
    .length(4)
    .nullable(),
});
export type VisionJobPayload = z.infer<typeof VisionJobPayload>;

export const AnalyticsJobPayload = z.discriminatedUnion('task', [
  z.object({ task: z.literal('simulate'), jobId: Id, matchId: Id, seed: z.number().int() }),
  /** Emitted by the vision worker once tracking JSON is in object storage. */
  z.object({ task: z.literal('events'), jobId: Id, matchId: Id, trackingKey: z.string() }),
  z.object({ task: z.literal('metrics'), jobId: Id, matchId: Id }),
  z.object({ task: z.literal('report'), jobId: Id, matchId: Id }),
]);
export type AnalyticsJobPayload = z.infer<typeof AnalyticsJobPayload>;

/** Redis pub/sub channel the worker publishes JobStreamEvents on. */
export const jobChannel = (jobId: string) => `soccalytics:job:${jobId}`;
