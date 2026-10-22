import type { PlayerMetrics, Position } from '@soccalytics/contracts';
import { clamp, round } from './math.js';

export interface RatingContext {
  /** Saves made (goalkeepers). */
  saves: number;
  /** Goals conceded by the team while the player was on the pitch (pro-rated). */
  goalsConceded: number;
}

/** Relative importance of each phase by role. */
const POSITION_WEIGHTS: Record<Position, { attack: number; possession: number; defending: number }> = {
  GK: { attack: 0.3, possession: 0.6, defending: 0.8 },
  CB: { attack: 0.6, possession: 0.9, defending: 1.2 },
  FB: { attack: 0.8, possession: 1.0, defending: 1.0 },
  DM: { attack: 0.7, possession: 1.1, defending: 1.1 },
  CM: { attack: 0.9, possession: 1.1, defending: 0.9 },
  AM: { attack: 1.1, possession: 1.0, defending: 0.6 },
  W: { attack: 1.1, possession: 1.0, defending: 0.6 },
  ST: { attack: 1.1, possession: 0.8, defending: 0.6 },
};

/**
 * Typical weighted contribution of a solid 90-minute performance per role,
 * subtracted so an average display lands around 6.5 (calibrated on simulated league data).
 */
const POSITION_BASELINE: Record<Position, number> = {
  GK: -0.1,
  CB: 0.5,
  FB: 1.0,
  DM: 1.7,
  CM: 1.9,
  AM: 2.2,
  W: 1.9,
  ST: 1.9,
};

/**
 * Composite 0–10 match rating.
 *
 * Phase scores are linear in match totals with weights roughly proportional
 * to each action's goal value (a goal ≈ 1.1, an xG of 1 ≈ 0.5 on top of the
 * goal itself, an xT unit ≈ 3, a won tackle ≈ 0.12…). They are weighted by the
 * role (defending matters more for centre-backs, attack for forwards),
 * re-centred on a role baseline pro-rated by minutes, added to a 6.0 neutral
 * score and clamped to 3–10. Players with very few minutes are shrunk towards
 * 6.0 because their sample is small.
 */
/**
 * Unscaled weighted contribution (before baseline/clamping) — exposed for
 * calibration and explainability.
 */
export function ratingContribution(position: Position, m: PlayerMetrics, ctx: RatingContext): number {
  const minutes = m.minutes;
  const w = POSITION_WEIGHTS[position];
  const attack =
    1.0 * m.goals + 0.5 * m.xg + 0.6 * m.xa + 0.15 * m.key_passes + 0.08 * m.shots_on_target + 0.08 * m.dribbles_completed;
  const passTerm = m.passes >= 10 ? ((m.pass_accuracy - 78) / 10) * 0.25 : 0;
  const possession =
    1.0 * m.xt_added + 0.03 * m.progressive_passes + 0.04 * m.progressive_carries + 0.003 * m.passes + passTerm;
  const defending =
    0.1 * m.tackles_won +
    0.1 * m.interceptions +
    0.03 * m.recoveries +
    0.04 * m.clearances +
    0.04 * m.pressure_regains +
    0.004 * m.pressures;
  let keeper = 0;
  if (position === 'GK') keeper = 0.3 * ctx.saves - 0.35 * ctx.goalsConceded;
  else if (position === 'CB' || position === 'FB' || position === 'DM') keeper = -0.12 * ctx.goalsConceded;
  return w.attack * attack + w.possession * possession + w.defending * defending + keeper - POSITION_BASELINE[position] * (minutes / 90);
}

/**
 * Composite 0–10 match rating.
 *
 * Phase scores are linear in match totals with weights roughly proportional
 * to each action's goal value (a goal ≈ 1, an xG of 1 ≈ 0.5 on top of the
 * goal itself, one unit of xT ≈ 1, a won tackle ≈ 0.1…). They are weighted by
 * role (defending matters more for centre-backs, attack for forwards) and
 * re-centred on a role baseline pro-rated by minutes, so a typical display
 * scores ≈ 6.5 and one standard deviation is roughly ±0.8. The result is added
 * to the 6.0 neutral score and clamped to 3–10. Players with fewer than 30
 * minutes are shrunk towards 6.0 because their sample is small.
 */
export function computeRating(position: Position, m: PlayerMetrics, ctx: RatingContext): number {
  if (m.minutes <= 0) return 6;
  const raw = ratingContribution(position, m, ctx);
  const shrink = Math.min(1, m.minutes / 30);
  return round(clamp(6 + raw * shrink, 3, 10), 2);
}
