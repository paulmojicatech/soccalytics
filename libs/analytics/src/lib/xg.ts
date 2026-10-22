import type { BodyPart, PlayPattern, Point } from '@soccalytics/contracts';
import { distanceToGoal, goalAngle } from './geometry.js';
import { clamp, sigmoid } from './math.js';

/**
 * Expected-goals model.
 *
 * A logistic regression on the two dominant features in every public xG model
 * (Caley 2015, Pollard & Reep 1997, StatsBomb/Opta docs): distance to the goal
 * centre `d` (m) and the goal-mouth angle `θ` (rad) the shooter sees between
 * the posts of the 7.32 m goal:
 *
 *   logit(xG) = β0 + βd·d + βθ·θ + β_body + β_pattern
 *
 * Coefficients were calibrated by hand against widely-published reference
 * values for open-play footed shots:
 *   - penalty spot (d = 11 m, θ ≈ 0.64)      → ≈ 0.20
 *   - six-yard box, central (d = 4 m)         → ≈ 0.50
 *   - 30 m, central                            → ≈ 0.03
 * Headers are roughly half as likely to score from the same spot (logit −0.9),
 * other body parts −0.5, fast breaks (+0.25) beat settled defences, and shots
 * from set pieces (−0.15) face crowded boxes. Penalties are fixed at 0.76, the
 * long-run conversion rate in top-flight football.
 */
export const XG_COEFFICIENTS = {
  intercept: -0.95,
  distance: -0.092,
  angle: 0.89,
  body: { foot: 0, head: -0.9, other: -0.5 } as Record<BodyPart, number>,
  pattern: { open_play: 0, set_piece: -0.15, counter: 0.25, penalty: 0 } as Record<PlayPattern, number>,
  penalty: 0.76,
} as const;

export interface ShotInput {
  start: Point;
  bodyPart?: BodyPart;
  playPattern?: PlayPattern;
}

export function xgForShot(shot: ShotInput): number {
  const pattern = shot.playPattern ?? 'open_play';
  if (pattern === 'penalty') return XG_COEFFICIENTS.penalty;
  const c = XG_COEFFICIENTS;
  const z =
    c.intercept +
    c.distance * distanceToGoal(shot.start) +
    c.angle * goalAngle(shot.start) +
    c.body[shot.bodyPart ?? 'foot'] +
    c.pattern[pattern];
  return clamp(sigmoid(z), 0.002, 0.95);
}
