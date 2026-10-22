import type { Position, Team, TeamLevel } from '@soccalytics/contracts';
import {
  ATTRIBUTE_KEYS,
  KEY_ATTRIBUTES,
  LEVEL_OFFSET,
  POSITION_ATTRIBUTE_MEANS,
  type LatentAttributes,
  type SimPlayer,
} from './attributes.js';
import { NAME_REGIONS } from './names.js';
import { Rng } from './rng.js';

export interface League {
  teams: Team[];
  players: SimPlayer[];
}

interface TeamSeed {
  name: string;
  shortName: string;
  level: TeamLevel;
  primaryColor: string;
  secondaryColor: string;
}

/** Fictional clubs. One pro side acts as the reference benchmark. */
export const TEAM_SEEDS: readonly TeamSeed[] = [
  { name: 'Kingsbridge Rovers', shortName: 'KBR', level: 'pro', primaryColor: '#1E3A8A', secondaryColor: '#F8FAFC' },
  { name: 'Harbourside Athletic U21', shortName: 'HAR', level: 'academy_u21', primaryColor: '#0F766E', secondaryColor: '#FDE68A' },
  { name: 'Northvale United U18', shortName: 'NVU', level: 'academy_u18', primaryColor: '#B91C1C', secondaryColor: '#FFFFFF' },
  { name: 'Ashford Vale', shortName: 'AFV', level: 'semi_pro', primaryColor: '#4C1D95', secondaryColor: '#FACC15' },
  { name: 'Riverside Wanderers U21', shortName: 'RSW', level: 'academy_u21', primaryColor: '#065F46', secondaryColor: '#F1F5F9' },
  { name: 'Eastmoor Town', shortName: 'EMT', level: 'semi_pro', primaryColor: '#C2410C', secondaryColor: '#1F2937' },
  { name: 'Westfield Academy U18', shortName: 'WFA', level: 'academy_u18', primaryColor: '#0369A1', secondaryColor: '#F97316' },
  { name: 'Highgate Lions U21', shortName: 'HGL', level: 'academy_u21', primaryColor: '#A16207', secondaryColor: '#111827' },
];

/** 18-man squad template: position and shirt number. */
export const SQUAD_TEMPLATE: readonly { position: Position; shirt: number }[] = [
  { position: 'GK', shirt: 1 },
  { position: 'GK', shirt: 13 },
  { position: 'FB', shirt: 2 },
  { position: 'FB', shirt: 3 },
  { position: 'FB', shirt: 12 },
  { position: 'CB', shirt: 4 },
  { position: 'CB', shirt: 5 },
  { position: 'CB', shirt: 15 },
  { position: 'DM', shirt: 6 },
  { position: 'DM', shirt: 16 },
  { position: 'CM', shirt: 8 },
  { position: 'CM', shirt: 14 },
  { position: 'AM', shirt: 10 },
  { position: 'AM', shirt: 18 },
  { position: 'W', shirt: 7 },
  { position: 'W', shirt: 11 },
  { position: 'ST', shirt: 9 },
  { position: 'ST', shirt: 19 },
];

/** Reference date ages are computed against (keeps generation deterministic). */
export const LEAGUE_REFERENCE_DATE = '2026-09-01';

const AGE_RANGE: Record<TeamLevel, [number, number]> = {
  academy_u16: [15, 16],
  academy_u18: [16, 18],
  academy_u21: [18, 21],
  semi_pro: [19, 33],
  pro: [20, 33],
};

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const clampAttr = (v: number): number => Math.round(Math.min(99, Math.max(15, v)));

function drawAttributes(rng: Rng, position: Position, level: TeamLevel, age: number): LatentAttributes {
  const mean = POSITION_ATTRIBUTE_MEANS[position];
  const offset = LEVEL_OFFSET[level];
  const out = {} as LatentAttributes;
  for (const k of ATTRIBUTE_KEYS) {
    // physical attributes mature later; technique is less level-dependent for youth
    const physical = k === 'pace' || k === 'stamina' || k === 'aerial';
    const youthPhysPenalty = physical && age < 19 ? -(19 - age) * 1.5 : 0;
    out[k] = clampAttr(rng.normal(mean[k] + offset + youthPhysPenalty, 8));
  }
  return out;
}

function birthDate(rng: Rng, age: number): string {
  const ref = new Date(`${LEAGUE_REFERENCE_DATE}T00:00:00Z`);
  const d = new Date(Date.UTC(ref.getUTCFullYear() - age - 1, ref.getUTCMonth(), ref.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + rng.int(1, 364));
  return d.toISOString().slice(0, 10);
}

function height(rng: Rng, position: Position): number {
  const mean = position === 'GK' ? 190 : position === 'CB' ? 186 : position === 'ST' ? 183 : position === 'W' ? 175 : 179;
  return Math.round(Math.min(201, Math.max(162, rng.normal(mean, 5))));
}

/**
 * Generate a deterministic 8-team league (one pro reference side, academy
 * U18/U21 and semi-pro clubs), 18 players each, with hidden attributes drawn
 * from position-specific distributions shifted by team level. A few
 * standout prospects per club get a boost on their role's key attributes.
 */
export function generateLeague(seed: number): League {
  const rng = new Rng(seed);
  const teams: Team[] = [];
  const players: SimPlayer[] = [];
  const usedNames = new Set<string>();
  const regionWeights = NAME_REGIONS.map((r) => r.weight);

  for (const ts of TEAM_SEEDS) {
    const slug = slugify(ts.name);
    const team: Team = {
      id: `team-${slug}`,
      name: ts.name,
      shortName: ts.shortName,
      level: ts.level,
      primaryColor: ts.primaryColor,
      secondaryColor: ts.secondaryColor,
    };
    teams.push(team);
    const trng = rng.fork(slug);
    const standoutCount = ts.level === 'pro' ? 1 : trng.int(1, 3);
    const outfieldIdx = SQUAD_TEMPLATE.map((_, i) => i).filter((i) => SQUAD_TEMPLATE[i]?.position !== 'GK');
    const standouts = new Set(trng.shuffle(outfieldIdx).slice(0, standoutCount));

    SQUAD_TEMPLATE.forEach(({ position, shirt }, i) => {
      const [minAge, maxAge] = AGE_RANGE[ts.level];
      const age = trng.int(minAge, maxAge);
      const attributes = drawAttributes(trng, position, ts.level, age);
      if (standouts.has(i)) {
        for (const k of KEY_ATTRIBUTES[position]) attributes[k] = clampAttr(attributes[k] + trng.range(10, 17));
      }
      const region = NAME_REGIONS[trng.weightedIndex(regionWeights)] ?? (NAME_REGIONS[0] as (typeof NAME_REGIONS)[number]);
      let name = '';
      for (let attempt = 0; attempt < 50; attempt++) {
        name = `${trng.pick(region.first)} ${trng.pick(region.last)}`;
        if (!usedNames.has(name)) break;
      }
      if (usedNames.has(name)) name = `${name} ${String.fromCharCode(65 + (usedNames.size % 26))}.`;
      usedNames.add(name);
      const footRoll = trng.next();
      const leftBias = position === 'FB' || position === 'W' ? 0.15 : 0;
      players.push({
        id: `player-${slug}-${i + 1}`,
        teamId: team.id,
        name,
        shirtNumber: shirt,
        position,
        birthDate: birthDate(trng, age),
        heightCm: height(trng, position),
        foot: footRoll < 0.08 ? 'both' : footRoll < 0.3 + leftBias ? 'left' : 'right',
        nationality: trng.pick(region.nationalities),
        attributes,
      });
    });
  }
  return { teams, players };
}
