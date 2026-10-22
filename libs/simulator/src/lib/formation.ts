import type { Position } from '@soccalytics/contracts';
import { roleScore, type SimPlayer } from './attributes.js';
import type { Rng } from './rng.js';

export type FormationName = '4-3-3' | '4-2-3-1';

export interface Slot {
  role: Position;
  /** Base location in the team frame (attacking towards x = 105) with the ball at the centre spot. */
  x: number;
  y: number;
}

export const FORMATIONS: Record<FormationName, readonly Slot[]> = {
  '4-3-3': [
    { role: 'GK', x: 5, y: 34 },
    { role: 'FB', x: 34, y: 8 },
    { role: 'CB', x: 28, y: 25 },
    { role: 'CB', x: 28, y: 43 },
    { role: 'FB', x: 34, y: 60 },
    { role: 'DM', x: 41, y: 34 },
    { role: 'CM', x: 52, y: 21 },
    { role: 'CM', x: 52, y: 47 },
    { role: 'W', x: 68, y: 9 },
    { role: 'ST', x: 74, y: 34 },
    { role: 'W', x: 68, y: 59 },
  ],
  '4-2-3-1': [
    { role: 'GK', x: 5, y: 34 },
    { role: 'FB', x: 34, y: 8 },
    { role: 'CB', x: 28, y: 25 },
    { role: 'CB', x: 28, y: 43 },
    { role: 'FB', x: 34, y: 60 },
    { role: 'DM', x: 42, y: 26 },
    { role: 'CM', x: 44, y: 42 },
    { role: 'W', x: 64, y: 9 },
    { role: 'AM', x: 61, y: 34 },
    { role: 'W', x: 64, y: 59 },
    { role: 'ST', x: 74, y: 34 },
  ],
};

/** Which natural positions can fill a slot, in order of preference. */
export const ROLE_PREFERENCES: Record<Position, readonly Position[]> = {
  GK: ['GK'],
  CB: ['CB', 'DM', 'FB'],
  FB: ['FB', 'CB', 'W'],
  DM: ['DM', 'CM', 'CB'],
  CM: ['CM', 'DM', 'AM'],
  AM: ['AM', 'CM', 'W'],
  W: ['W', 'AM', 'ST', 'FB'],
  ST: ['ST', 'W', 'AM'],
};

export interface Selection {
  formation: FormationName;
  starters: { player: SimPlayer; slot: number }[];
  bench: SimPlayer[];
}

/**
 * Pick a formation and the best XI for it. Players are scored by their fit for
 * the slot role plus a little match-day noise (form/rotation), so squad
 * players occasionally start.
 */
export function selectLineup(players: readonly SimPlayer[], rng: Rng): Selection {
  const formation: FormationName = rng.chance(0.5) ? '4-3-3' : '4-2-3-1';
  const slots = FORMATIONS[formation];
  const form = new Map(players.map((p) => [p.id, rng.normal(0, 4)]));
  const used = new Set<string>();
  const starters: { player: SimPlayer; slot: number }[] = [];
  // fill scarce roles first
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => rolePriority(a.s.role) - rolePriority(b.s.role));
  for (const { s, i } of order) {
    let chosen: SimPlayer | undefined;
    for (const [rank, pos] of ROLE_PREFERENCES[s.role].entries()) {
      const pool = players.filter((p) => !used.has(p.id) && p.position === pos);
      if (!pool.length) continue;
      const scored = pool
        .map((p) => ({ p, v: roleScore(p.attributes, s.role) + (form.get(p.id) ?? 0) - rank * 6 }))
        .sort((a, b) => b.v - a.v || a.p.id.localeCompare(b.p.id));
      chosen = scored[0]?.p;
      break;
    }
    if (!chosen) chosen = players.find((p) => !used.has(p.id) && (s.role === 'GK') === (p.position === 'GK'));
    if (!chosen) chosen = players.find((p) => !used.has(p.id));
    if (!chosen) throw new Error('not enough players for a lineup');
    used.add(chosen.id);
    starters.push({ player: chosen, slot: i });
  }
  starters.sort((a, b) => a.slot - b.slot);
  return { formation, starters, bench: players.filter((p) => !used.has(p.id)) };
}

const rolePriority = (r: Position): number => ['GK', 'ST', 'AM', 'DM', 'CB', 'FB', 'W', 'CM'].indexOf(r);
