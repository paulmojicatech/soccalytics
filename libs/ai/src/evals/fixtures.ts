import {
  PlayerMetricKey,
  type MatchEvent,
  type MatchSummary,
  type Player,
  type PlayerMatchStats,
  type PlayerMetrics,
  type TeamMatchStats,
} from '@soccalytics/contracts';
import type { MatchContextInput, PlayerContextInput } from '../lib/context.js';

/** Hand-built golden inputs. Kept small so evals are cheap and reviewable. */

const metrics = (o: Partial<PlayerMetrics>): PlayerMetrics =>
  Object.fromEntries(PlayerMetricKey.options.map((k) => [k, o[k] ?? 0])) as PlayerMetrics;

const team = (id: string, name: string) => ({
  id,
  name,
  shortName: name.slice(0, 3).toUpperCase(),
  level: 'academy_u21' as const,
  primaryColor: '#1d4ed8',
  secondaryColor: '#ffffff',
});

const player = (id: string, teamId: string, name: string, position: Player['position'], n: number): Player => ({
  id,
  teamId,
  name,
  shirtNumber: n,
  position,
  birthDate: '2005-04-12',
  heightCm: 178,
  foot: 'right',
  nationality: 'ENG',
});

const teamStats = (teamId: string, o: Partial<TeamMatchStats>): TeamMatchStats => ({
  matchId: 'eval-m1',
  teamId,
  goals: 0,
  xg: 0,
  shots: 0,
  possessionPct: 50,
  passes: 400,
  passAccuracy: 80,
  ppda: 12,
  fieldTilt: 50,
  progressivePasses: 30,
  pressures: 150,
  highRegains: 6,
  distanceKm: 110,
  passingNetwork: { teamId, nodes: [], edges: [] },
  xgTimeline: [],
  ...o,
});

const pstat = (playerId: string, teamId: string, position: Player['position'], rating: number, m: Partial<PlayerMetrics>): PlayerMatchStats => ({
  matchId: 'eval-m1',
  playerId,
  teamId,
  position,
  rating,
  metrics: metrics({ minutes: 90, ...m }),
  avgPosition: { x: 50, y: 34 },
});

const home = team('t-riverside', 'Riverside Academy');
const away = team('t-northgate', 'Northgate United');

const match: MatchSummary = {
  id: 'eval-m1',
  homeTeamId: home.id,
  awayTeamId: away.id,
  kickoffAt: '2026-10-04T14:00:00.000Z',
  competition: 'U21 Premier Development League',
  venue: null,
  status: 'analysed',
  source: 'simulation',
  homeScore: 1,
  awayScore: 2,
  durationSec: 5580,
  homeTeam: home,
  awayTeam: away,
  homeXg: 2.31,
  awayXg: 0.94,
};

const players = [
  player('p-h9', home.id, 'Kai Mensah', 'ST', 9),
  player('p-h8', home.id, 'Leo Varga', 'CM', 8),
  player('p-h3', home.id, 'Sam Okafor', 'FB', 3),
  player('p-a10', away.id, 'Ruben Costa', 'AM', 10),
  player('p-a4', away.id, 'Jonah Pike', 'CB', 4),
];

const shot = (id: string, playerId: string, teamId: string, t: number, xg: number, goal: boolean): MatchEvent => ({
  id,
  matchId: 'eval-m1',
  teamId,
  playerId,
  period: 1,
  t,
  type: 'shot',
  start: { x: 92, y: 34 },
  end: { x: 105, y: 34 },
  success: goal,
  bodyPart: 'foot',
  playPattern: 'open_play',
  recipientId: null,
  xg,
  xt: null,
  progressive: false,
  confidence: 1,
});

/** Home dominated chance quality but lost: the report should notice finishing variance. */
export const MATCH_FIXTURE: MatchContextInput = {
  match,
  focusTeamId: home.id,
  players,
  teamStats: [
    teamStats(home.id, { goals: 1, xg: 2.31, shots: 17, possessionPct: 61, ppda: 8.4, fieldTilt: 66, progressivePasses: 48, highRegains: 11 }),
    teamStats(away.id, { goals: 2, xg: 0.94, shots: 7, possessionPct: 39, ppda: 15.2, fieldTilt: 34, progressivePasses: 21, highRegains: 3 }),
  ],
  playerStats: [
    pstat('p-h9', home.id, 'ST', 6.4, { shots: 7, xg: 1.42, goals: 0, shots_on_target: 3 }),
    pstat('p-h8', home.id, 'CM', 7.9, { passes: 71, pass_accuracy: 89.5, progressive_passes: 11, key_passes: 4, xa: 0.83, xt_added: 0.41 }),
    pstat('p-h3', home.id, 'FB', 7.1, { pressures: 24, pressure_regains: 6, progressive_carries: 5 }),
    pstat('p-a10', away.id, 'AM', 8.3, { goals: 2, xg: 0.61, shots: 3 }),
    pstat('p-a4', away.id, 'CB', 7.2, { clearances: 11, interceptions: 5 }),
  ],
  shots: [
    shot('s1', 'p-a10', away.id, 600, 0.31, true),
    shot('s2', 'p-h9', home.id, 1300, 0.52, false),
    shot('s3', 'p-h9', home.id, 2100, 0.44, true),
    shot('s4', 'p-a10', away.id, 2500, 0.18, true),
  ],
};

export const PLAYER_FIXTURE: PlayerContextInput = {
  player: players[2]!,
  team: home,
  age: 21,
  profile: {
    playerId: 'p-h3',
    position: 'FB',
    matches: 9,
    minutes: 790,
    avgRating: 7.05,
    per90: metrics({ minutes: 790, pressures: 22.4, pressure_regains: 5.1, progressive_carries: 4.2, progressive_passes: 5.5, crosses: 3.1, pass_accuracy: 81.2, top_speed_kmh: 33.4, distance_km: 11.2 }),
  },
  benchmark: {
    playerId: 'p-h3',
    cohort: 'position_peers',
    cohortSize: 24,
    metrics: [
      { metric: 'pressures', value: 22.4, cohortMedian: 15.0, percentile: 91, zScore: 1.6 },
      { metric: 'pressure_regains', value: 5.1, cohortMedian: 3.2, percentile: 88, zScore: 1.3 },
      { metric: 'progressive_carries', value: 4.2, cohortMedian: 2.5, percentile: 83, zScore: 1.1 },
      { metric: 'crosses', value: 3.1, cohortMedian: 3.4, percentile: 44, zScore: -0.2 },
      { metric: 'pass_accuracy', value: 81.2, cohortMedian: 84.0, percentile: 29, zScore: -0.7 },
      { metric: 'xa', value: 0.04, cohortMedian: 0.09, percentile: 18, zScore: -1.0 },
    ],
    strengths: ['pressures', 'pressure_regains', 'progressive_carries'],
    weaknesses: ['xa', 'pass_accuracy'],
  },
  trend: {
    playerId: 'p-h3',
    points: [],
    ratingSlope: 0.12,
    projection: { horizonMatches: 5, rating: 7.6, low: 6.9, high: 8.3 },
  },
  similar: [{ playerId: 'p-x', name: 'Theo Lindqvist', teamName: 'Harbour City', position: 'FB', similarity: 0.93 }],
};

export const SCOUT_FIXTURES: { query: string; expect: { positions?: string[]; maxAgeAtMost?: number; foot?: string; rankByAny?: string[] } }[] = [
  {
    query: 'Left-footed full-backs under 21 who progress the ball and press hard',
    expect: { positions: ['FB'], maxAgeAtMost: 20, foot: 'left', rankByAny: ['progressive_carries', 'progressive_passes', 'pressures'] },
  },
  { query: 'Clinical strikers with elite xG per 90', expect: { positions: ['ST'], rankByAny: ['xg', 'goals'] } },
  { query: 'Ball-winning defensive midfielders with a big engine', expect: { positions: ['DM'], rankByAny: ['tackles_won', 'interceptions', 'recoveries', 'distance_km'] } },
];
