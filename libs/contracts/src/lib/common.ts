import { z } from 'zod';

/**
 * Pitch coordinate system (metres), shared by tracking and event data.
 *
 *   (0,68) ┌──────────────────────┐ (105,68)
 *          │                      │
 *          │   attacking  ──▶     │
 *          │                      │
 *    (0,0) └──────────────────────┘ (105,0)
 *
 * Event data is always normalised so the acting team attacks towards x = 105.
 * Tracking data keeps raw orientation; `TrackingMeta.homeAttacksRight` tells
 * you which way the home side attacks in each period.
 */
export const PITCH = { length: 105, width: 68 } as const;
export const GOAL_CENTER = { x: PITCH.length, y: PITCH.width / 2 } as const;
export const GOAL_WIDTH = 7.32;

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const Timestamp = z.iso.datetime();

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const ApiError = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
