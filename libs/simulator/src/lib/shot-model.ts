import type { BodyPart, PlayPattern } from '@soccalytics/contracts';

/**
 * Chance-quality model used *inside* the simulator to decide when players
 * shoot and how often they score. It mirrors the shape of the analytics xG
 * model (logistic on distance and goal-mouth angle) but is kept separate so
 * the simulator never depends on the analytics engine.
 */
export function chanceQuality(x: number, y: number, bodyPart: BodyPart = 'foot', pattern: PlayPattern = 'open_play'): number {
  if (pattern === 'penalty') return 0.76;
  const dx = Math.max(105 - x, 0.01);
  const d = Math.hypot(105 - x, 34 - y);
  const angle = Math.abs(Math.atan2(34 + 3.66 - y, dx) - Math.atan2(34 - 3.66 - y, dx));
  let z = -0.95 - 0.092 * d + 0.89 * angle;
  if (bodyPart === 'head') z -= 0.9;
  if (bodyPart === 'other') z -= 0.5;
  if (pattern === 'counter') z += 0.25;
  if (pattern === 'set_piece') z -= 0.15;
  return 1 / (1 + Math.exp(-z));
}
