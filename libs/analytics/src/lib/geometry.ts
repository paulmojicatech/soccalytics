import { GOAL_CENTER, GOAL_WIDTH, PITCH, type Point } from '@soccalytics/contracts';

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Distance (m) from `p` to the centre of the goal being attacked (x = 105). */
export const distanceToGoal = (p: Point): number => distance(p, GOAL_CENTER);

/**
 * Angle (radians) subtended by the goal mouth at `p` — the opening a shooter
 * "sees" between the two posts. 0 on the goal line outside the posts, → π
 * when standing on the line between them.
 */
export const goalAngle = (p: Point): number => {
  const half = GOAL_WIDTH / 2;
  const dx = Math.max(PITCH.length - p.x, 0.01);
  const a1 = Math.atan2(GOAL_CENTER.y - half - p.y, dx);
  const a2 = Math.atan2(GOAL_CENTER.y + half - p.y, dx);
  return Math.abs(a2 - a1);
};

/** Rotate a point 180° about the pitch centre (switch attacking direction). */
export const flipPoint = (p: Point): Point => ({ x: PITCH.length - p.x, y: PITCH.width - p.y });

export const inOwnHalf = (p: Point): boolean => p.x < PITCH.length / 2;
