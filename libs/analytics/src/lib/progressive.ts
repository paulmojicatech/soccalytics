import { PITCH, type MatchEvent } from '@soccalytics/contracts';
import { distanceToGoal } from './geometry.js';

const PROGRESSIVE_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['pass', 'cross', 'carry']);

/**
 * Progressive action, Wyscout definition: a *successful* pass (incl. cross) or
 * carry that moves the ball closer to the centre of the opponent's goal by
 *   - ≥ 30 m when it starts and ends in the own half,
 *   - ≥ 15 m when it starts in the own half and ends in the opponent half,
 *   - ≥ 10 m when it starts and ends in the opponent half.
 * Backward moves across halves (opp → own) can never qualify.
 * (Unlike FBref/StatsBomb we do not exclude actions from the defensive 40 %.)
 */
export function isProgressive(e: Pick<MatchEvent, 'type' | 'start' | 'end' | 'success'>): boolean {
  if (!e.success || !PROGRESSIVE_TYPES.has(e.type)) return false;
  const gain = distanceToGoal(e.start) - distanceToGoal(e.end);
  const half = PITCH.length / 2;
  const startOwn = e.start.x < half;
  const endOwn = e.end.x < half;
  if (startOwn && endOwn) return gain >= 30;
  if (startOwn && !endOwn) return gain >= 15;
  if (!startOwn && !endOwn) return gain >= 10;
  return false;
}
