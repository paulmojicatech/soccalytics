import { z } from 'zod';
import { Id } from './common.js';

/** One sampled instant of positional data (raw pitch orientation). */
export const TrackingFrame = z.object({
  period: z.number().int(),
  /** Seconds since the start of the period (same clock as MatchEvent.t). */
  t: z.number(),
  ball: z.object({ x: z.number(), y: z.number(), z: z.number().default(0) }).nullable(),
  players: z.array(
    z.object({
      playerId: Id,
      teamId: Id,
      x: z.number(),
      y: z.number(),
    }),
  ),
});
export type TrackingFrame = z.infer<typeof TrackingFrame>;

export const TrackingMeta = z.object({
  matchId: Id,
  fps: z.number(),
  frameCount: z.number().int(),
  homeTeamId: Id,
  awayTeamId: Id,
  /** Index = period - 1. */
  homeAttacksRight: z.array(z.boolean()),
  source: z.enum(['cv', 'simulation', 'gps']),
});
export type TrackingMeta = z.infer<typeof TrackingMeta>;

/** Tracking is stored in object storage as gzipped JSON, not in Postgres. */
export const TrackingDocument = z.object({
  meta: TrackingMeta,
  frames: z.array(TrackingFrame),
});
export type TrackingDocument = z.infer<typeof TrackingDocument>;
