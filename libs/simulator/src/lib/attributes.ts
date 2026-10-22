import type { Player, Position, TeamLevel } from '@soccalytics/contracts';

/**
 * Hidden 0–100 player qualities that drive simulated behaviour. They are
 * never exposed as metrics; analytics must rediscover them from events and
 * tracking.
 */
export interface LatentAttributes {
  passing: number;
  vision: number;
  dribbling: number;
  finishing: number;
  pace: number;
  stamina: number;
  workRate: number;
  tackling: number;
  positioning: number;
  aerial: number;
}

export type AttributeKey = keyof LatentAttributes;

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'passing',
  'vision',
  'dribbling',
  'finishing',
  'pace',
  'stamina',
  'workRate',
  'tackling',
  'positioning',
  'aerial',
];

export type SimPlayer = Player & { attributes: LatentAttributes };

/** Mean attribute profile per position at a neutral (≈ semi-pro) level. */
export const POSITION_ATTRIBUTE_MEANS: Record<Position, LatentAttributes> = {
  GK: { passing: 48, vision: 42, dribbling: 30, finishing: 15, pace: 45, stamina: 55, workRate: 50, tackling: 25, positioning: 65, aerial: 66 },
  CB: { passing: 55, vision: 46, dribbling: 40, finishing: 30, pace: 58, stamina: 65, workRate: 62, tackling: 70, positioning: 68, aerial: 72 },
  FB: { passing: 60, vision: 52, dribbling: 58, finishing: 35, pace: 72, stamina: 72, workRate: 68, tackling: 62, positioning: 60, aerial: 52 },
  DM: { passing: 66, vision: 60, dribbling: 52, finishing: 40, pace: 58, stamina: 72, workRate: 72, tackling: 66, positioning: 66, aerial: 58 },
  CM: { passing: 70, vision: 66, dribbling: 60, finishing: 50, pace: 62, stamina: 72, workRate: 68, tackling: 56, positioning: 60, aerial: 52 },
  AM: { passing: 70, vision: 72, dribbling: 70, finishing: 62, pace: 66, stamina: 64, workRate: 60, tackling: 40, positioning: 58, aerial: 45 },
  W: { passing: 60, vision: 62, dribbling: 72, finishing: 60, pace: 78, stamina: 66, workRate: 62, tackling: 38, positioning: 55, aerial: 42 },
  ST: { passing: 56, vision: 58, dribbling: 64, finishing: 72, pace: 72, stamina: 62, workRate: 58, tackling: 35, positioning: 66, aerial: 66 },
};

/** The attributes that define excellence in each role (used for standouts and selection). */
export const KEY_ATTRIBUTES: Record<Position, readonly AttributeKey[]> = {
  GK: ['positioning', 'aerial', 'passing'],
  CB: ['tackling', 'positioning', 'aerial', 'passing'],
  FB: ['pace', 'stamina', 'tackling', 'passing'],
  DM: ['tackling', 'passing', 'positioning', 'workRate'],
  CM: ['passing', 'vision', 'stamina', 'workRate'],
  AM: ['vision', 'passing', 'dribbling', 'finishing'],
  W: ['pace', 'dribbling', 'finishing', 'vision'],
  ST: ['finishing', 'positioning', 'pace', 'aerial'],
};

/** Additive shift of every attribute by competition level. */
export const LEVEL_OFFSET: Record<TeamLevel, number> = {
  academy_u16: -14,
  academy_u18: -9,
  academy_u21: -5,
  semi_pro: -2,
  pro: 7,
};

/** Overall suitability of a player for a role (mean of the role's key attributes). */
export function roleScore(a: LatentAttributes, role: Position): number {
  const keys = KEY_ATTRIBUTES[role];
  return keys.reduce((s, k) => s + a[k], 0) / keys.length;
}
