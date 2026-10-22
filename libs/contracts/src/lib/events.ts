import { z } from 'zod';
import { Id, Point } from './common.js';

/**
 * SPADL-inspired on-ball action vocabulary. Every action has a start and end
 * location (identical for stationary actions) normalised so the acting team
 * attacks towards x = 105.
 */
export const EventType = z.enum([
  'pass',
  'cross',
  'carry',
  'dribble',
  'shot',
  'tackle',
  'interception',
  'clearance',
  'recovery',
  'pressure',
  'foul',
  'save',
]);
export type EventType = z.infer<typeof EventType>;

export const BodyPart = z.enum(['foot', 'head', 'other']);
export type BodyPart = z.infer<typeof BodyPart>;

export const PlayPattern = z.enum(['open_play', 'set_piece', 'counter', 'penalty']);
export type PlayPattern = z.infer<typeof PlayPattern>;

export const MatchEvent = z.object({
  id: Id,
  matchId: Id,
  teamId: Id,
  playerId: Id,
  period: z.number().int().min(1).max(4),
  /** Seconds since kickoff of the period. */
  t: z.number().min(0),
  type: EventType,
  start: Point,
  end: Point,
  success: z.boolean(),
  bodyPart: BodyPart.default('foot'),
  playPattern: PlayPattern.default('open_play'),
  /** Receiver for passes/crosses, if completed. */
  recipientId: Id.nullable().default(null),
  /** Populated by the analytics engine, not by detection. */
  xg: z.number().nullable().default(null),
  xt: z.number().nullable().default(null),
  progressive: z.boolean().default(false),
  /** Detection confidence from the CV pipeline (1 for simulated/manual). */
  confidence: z.number().min(0).max(1).default(1),
});
export type MatchEvent = z.infer<typeof MatchEvent>;
export type MatchEventInput = z.input<typeof MatchEvent>;
