import {
  GOAL_CENTER,
  GOAL_WIDTH,
  PITCH,
  PlayerMetricKey,
  type Lineup,
  type Match,
  type MatchEvent,
  type PassingNetwork,
  type PlayerMatchStats,
  type PlayerMetrics,
  type Point,
  type Position,
  type TeamMatchStats,
  type TrackingDocument,
} from '@soccalytics/contracts';
import { computePhysical } from './physical.js';
import { isProgressive } from './progressive.js';
import { computeRating } from './rating.js';
import { xgForShot } from './xg.js';
import { round } from './math.js';

export interface MatchStatsInput {
  match: Match;
  lineups: Lineup[];
  events: MatchEvent[];
  tracking: TrackingDocument | null;
}

export interface MatchStatsResult {
  players: PlayerMatchStats[];
  teams: TeamMatchStats[];
}

/** Seconds window after a pass in which a recipient's shot makes it a key pass. */
export const KEY_PASS_WINDOW_S = 6;
/** Seconds after a pressure in which a regain by the presser's team counts. */
export const PRESSURE_REGAIN_WINDOW_S = 5;
/** Own-frame x from which a regain is "high" (attacking ~third). */
export const HIGH_REGAIN_X = 70;
/** Final-third line for field tilt. */
export const FINAL_THIRD_X = 70;
/** PPDA zone: opponent passes in their own defensive 60 % of the pitch. */
export const PPDA_ZONE_X = PITCH.length * 0.6;

const PASS_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['pass', 'cross']);
const POSSESSION_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['pass', 'cross', 'carry', 'dribble']);
const ON_BALL_TYPES: ReadonlySet<MatchEvent['type']> = new Set([
  'pass',
  'cross',
  'carry',
  'dribble',
  'shot',
  'tackle',
  'interception',
  'clearance',
  'recovery',
  'save',
]);
const REGAIN_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['tackle', 'interception', 'recovery']);
const DEFENSIVE_ACTION_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['tackle', 'interception', 'foul']);

const DEFAULT_POSITION: Record<Position, Point> = {
  GK: { x: 6, y: 34 },
  CB: { x: 28, y: 34 },
  FB: { x: 38, y: 34 },
  DM: { x: 42, y: 34 },
  CM: { x: 52, y: 34 },
  AM: { x: 64, y: 34 },
  W: { x: 68, y: 34 },
  ST: { x: 75, y: 34 },
};

export const emptyMetrics = (): PlayerMetrics =>
  Object.fromEntries(PlayerMetricKey.options.map((k) => [k, 0])) as PlayerMetrics;

const absMinute = (e: Pick<MatchEvent, 'period' | 't'>): number =>
  e.t / 60 + (e.period === 1 ? 0 : e.period === 2 ? 45 : e.period === 3 ? 90 : 105);

/** Shot reached the goal mouth (scored or saved). */
export const isOnTarget = (e: MatchEvent): boolean =>
  e.type === 'shot' &&
  (e.success || (e.end.x >= PITCH.length - 0.5 && Math.abs(e.end.y - GOAL_CENTER.y) <= GOAL_WIDTH / 2 + 0.1));

const shotXg = (e: MatchEvent): number => e.xg ?? xgForShot(e);

/**
 * Per-player and per-team statistics for one match from enriched events
 * (+ tracking for physical metrics). See inline docs for definitions.
 */
export function computeMatchStats(input: MatchStatsInput): MatchStatsResult {
  const { match, lineups } = input;
  const events = input.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.period - b.e.period || a.e.t - b.e.t || a.i - b.i)
    .map(({ e }) => e);
  const teamIds = [match.homeTeamId, match.awayTeamId];
  const opponentOf = (teamId: string): string => (teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId);

  // ---------- roster ----------
  interface Row {
    playerId: string;
    teamId: string;
    position: Position;
    minutes: number;
  }
  const roster = new Map<string, Row>();
  for (const l of lineups) {
    if (l.matchId !== match.id && lineups.some((x) => x.matchId === match.id)) continue;
    if (l.minutesPlayed <= 0 && !l.starter) continue;
    roster.set(l.playerId, { playerId: l.playerId, teamId: l.teamId, position: l.position, minutes: l.minutesPlayed });
  }
  const physical = input.tracking ? computePhysical(input.tracking) : new Map();
  const trackedMinutes = new Map<string, number>();
  if (input.tracking) {
    const fps = input.tracking.meta.fps || 10;
    for (const f of input.tracking.frames)
      for (const p of f.players) trackedMinutes.set(p.playerId, (trackedMinutes.get(p.playerId) ?? 0) + 1 / fps / 60);
  }
  for (const e of events) {
    if (!roster.has(e.playerId) && teamIds.includes(e.teamId)) {
      roster.set(e.playerId, {
        playerId: e.playerId,
        teamId: e.teamId,
        position: 'CM',
        minutes: round(Math.min(trackedMinutes.get(e.playerId) ?? 90, 90), 1),
      });
    }
  }

  const metrics = new Map<string, PlayerMetrics>();
  const saves = new Map<string, number>();
  const onBall = new Map<string, Point[]>();
  for (const r of roster.values()) {
    const m = emptyMetrics();
    m.minutes = r.minutes;
    const ph = physical.get(r.playerId);
    if (ph) Object.assign(m, ph);
    metrics.set(r.playerId, m);
  }
  const M = (pid: string): PlayerMetrics | undefined => metrics.get(pid);
  const passCompleted = new Map<string, number>();

  // ---------- per-event counting ----------
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx] as MatchEvent;
    const m = M(e.playerId);
    if (!m) continue;
    if (ON_BALL_TYPES.has(e.type)) {
      let arr = onBall.get(e.playerId);
      if (!arr) onBall.set(e.playerId, (arr = []));
      arr.push(e.start);
    }
    if (e.xt != null) m.xt_added += e.xt;
    switch (e.type) {
      case 'pass':
      case 'cross': {
        m.passes++;
        if (e.type === 'cross') m.crosses++;
        if (e.success) passCompleted.set(e.playerId, (passCompleted.get(e.playerId) ?? 0) + 1);
        if (e.progressive || isProgressive(e)) m.progressive_passes++;
        if (e.success && e.recipientId) {
          const shot = findAssistedShot(events, idx);
          if (shot) {
            m.key_passes++;
            m.xa += shotXg(shot);
          }
        }
        break;
      }
      case 'carry':
        if (e.progressive || isProgressive(e)) m.progressive_carries++;
        break;
      case 'dribble':
        if (e.success) m.dribbles_completed++;
        break;
      case 'shot':
        m.shots++;
        m.xg += shotXg(e);
        if (e.success) m.goals++;
        if (isOnTarget(e)) m.shots_on_target++;
        break;
      case 'pressure': {
        m.pressures++;
        const t0 = absMinute(e) * 60;
        for (let j = idx + 1; j < events.length; j++) {
          const n = events[j] as MatchEvent;
          if (n.period !== e.period || absMinute(n) * 60 - t0 > PRESSURE_REGAIN_WINDOW_S) break;
          if (n.teamId === e.teamId && REGAIN_TYPES.has(n.type) && n.success) {
            m.pressure_regains++;
            break;
          }
          if (n.teamId !== e.teamId && n.type === 'shot') break;
        }
        break;
      }
      case 'tackle':
        if (e.success) m.tackles_won++;
        break;
      case 'interception':
        if (e.success) m.interceptions++;
        break;
      case 'recovery':
        if (e.success) m.recoveries++;
        break;
      case 'clearance':
        m.clearances++;
        break;
      case 'save':
        saves.set(e.playerId, (saves.get(e.playerId) ?? 0) + 1);
        break;
      default:
        break;
    }
  }
  for (const [pid, m] of metrics) {
    m.pass_accuracy = m.passes ? round(((passCompleted.get(pid) ?? 0) / m.passes) * 100, 1) : 0;
    m.xg = round(m.xg, 3);
    m.xa = round(m.xa, 3);
    m.xt_added = round(m.xt_added, 4);
  }

  // ---------- team stats ----------
  const goalsBy = new Map<string, number>(teamIds.map((t) => [t, 0]));
  for (const e of events) if (e.type === 'shot' && e.success) goalsBy.set(e.teamId, (goalsBy.get(e.teamId) ?? 0) + 1);

  const players: PlayerMatchStats[] = [...roster.values()].map((r) => {
    const m = metrics.get(r.playerId) as PlayerMetrics;
    const pts = onBall.get(r.playerId);
    const avg = pts?.length
      ? { x: round(pts.reduce((a, p) => a + p.x, 0) / pts.length, 2), y: round(pts.reduce((a, p) => a + p.y, 0) / pts.length, 2) }
      : DEFAULT_POSITION[r.position];
    const conceded = (goalsBy.get(opponentOf(r.teamId)) ?? 0) * Math.min(1, r.minutes / 90);
    return {
      matchId: match.id,
      playerId: r.playerId,
      teamId: r.teamId,
      position: r.position,
      metrics: m,
      rating: computeRating(r.position, m, { saves: saves.get(r.playerId) ?? 0, goalsConceded: conceded }),
      avgPosition: avg,
    };
  });

  const possessionCount = new Map<string, number>(teamIds.map((t) => [t, 0]));
  const finalThirdPasses = new Map<string, number>(teamIds.map((t) => [t, 0]));
  for (const e of events) {
    if (POSSESSION_TYPES.has(e.type)) possessionCount.set(e.teamId, (possessionCount.get(e.teamId) ?? 0) + 1);
    if (PASS_TYPES.has(e.type) && e.start.x >= FINAL_THIRD_X)
      finalThirdPasses.set(e.teamId, (finalThirdPasses.get(e.teamId) ?? 0) + 1);
  }
  const totalPoss = [...possessionCount.values()].reduce((a, b) => a + b, 0);
  const totalFinalThird = [...finalThirdPasses.values()].reduce((a, b) => a + b, 0);

  const teams: TeamMatchStats[] = teamIds.map((teamId) => {
    const own = events.filter((e) => e.teamId === teamId);
    const opp = events.filter((e) => e.teamId === opponentOf(teamId));
    const passes = own.filter((e) => PASS_TYPES.has(e.type));
    const completed = passes.filter((e) => e.success).length;
    const shots = own.filter((e) => e.type === 'shot');
    const teamPlayers = players.filter((p) => p.teamId === teamId);
    return {
      matchId: match.id,
      teamId,
      goals: goalsBy.get(teamId) ?? 0,
      xg: round(shots.reduce((a, e) => a + shotXg(e), 0), 3),
      shots: shots.length,
      possessionPct: totalPoss ? round(((possessionCount.get(teamId) ?? 0) / totalPoss) * 100, 1) : 50,
      passes: passes.length,
      passAccuracy: passes.length ? round((completed / passes.length) * 100, 1) : 0,
      ppda: computePpda(own, opp),
      fieldTilt: totalFinalThird ? round(((finalThirdPasses.get(teamId) ?? 0) / totalFinalThird) * 100, 1) : 50,
      progressivePasses: passes.filter((e) => e.progressive || isProgressive(e)).length,
      pressures: own.filter((e) => e.type === 'pressure').length,
      highRegains: own.filter((e) => REGAIN_TYPES.has(e.type) && e.success && e.start.x >= HIGH_REGAIN_X).length,
      distanceKm: round(teamPlayers.reduce((a, p) => a + p.metrics.distance_km, 0), 2),
      passingNetwork: buildPassingNetwork(teamId, own),
      xgTimeline: buildXgTimeline(shots, events),
    };
  });

  return { players, teams };
}

/**
 * Find the shot "assisted" by the completed pass at `idx`: the recipient
 * shoots within KEY_PASS_WINDOW_S, possibly after carrying/dribbling, with no
 * other on-ball action by anyone in between (opponent pressures are ignored).
 */
function findAssistedShot(events: readonly MatchEvent[], idx: number): MatchEvent | null {
  const pass = events[idx] as MatchEvent;
  for (let j = idx + 1; j < events.length; j++) {
    const n = events[j] as MatchEvent;
    if (n.period !== pass.period || n.t - pass.t > KEY_PASS_WINDOW_S) return null;
    if (n.type === 'pressure' || n.type === 'foul') continue;
    if (n.playerId !== pass.recipientId) return null;
    if (n.type === 'shot') return n;
    if (n.type !== 'carry' && n.type !== 'dribble') return null;
  }
  return null;
}

/**
 * PPDA for the defending team `own`: opponent passes made in *their* own
 * defensive 60 % (x ≤ 63 in the opponent's frame) divided by our defensive
 * actions (tackles, interceptions, fouls) in that same zone. Our events are in
 * our frame, so the zone becomes x ≥ 105 − 63 = 42 for us.
 */
export function computePpda(own: readonly MatchEvent[], opp: readonly MatchEvent[]): number {
  const oppPasses = opp.filter((e) => PASS_TYPES.has(e.type) && e.start.x <= PPDA_ZONE_X).length;
  const defActions = own.filter(
    (e) => DEFENSIVE_ACTION_TYPES.has(e.type) && e.start.x >= PITCH.length - PPDA_ZONE_X,
  ).length;
  return round(oppPasses / Math.max(1, defActions), 2);
}

/**
 * Passing network: node = mean location of a player's completed passes
 * (origins) and receptions (destinations); touches = their count. Directed
 * edges count completed passes between a pair, kept when ≥ 2.
 */
export function buildPassingNetwork(teamId: string, teamEvents: readonly MatchEvent[]): PassingNetwork {
  const loc = new Map<string, { x: number; y: number; n: number }>();
  const add = (pid: string, p: Point) => {
    const cur = loc.get(pid) ?? { x: 0, y: 0, n: 0 };
    cur.x += p.x;
    cur.y += p.y;
    cur.n++;
    loc.set(pid, cur);
  };
  const edges = new Map<string, number>();
  for (const e of teamEvents) {
    if (!PASS_TYPES.has(e.type) || !e.success || !e.recipientId) continue;
    add(e.playerId, e.start);
    add(e.recipientId, e.end);
    const key = `${e.playerId}\u0000${e.recipientId}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  return {
    teamId,
    nodes: [...loc.entries()].map(([playerId, v]) => ({
      playerId,
      x: round(v.x / v.n, 2),
      y: round(v.y / v.n, 2),
      touches: v.n,
    })),
    edges: [...edges.entries()]
      .filter(([, c]) => c >= 2)
      .map(([k, count]) => {
        const [from, to] = k.split('\u0000') as [string, string];
        return { from, to, count };
      }),
  };
}

/**
 * Cumulative xG at 0, 5, 10 … minutes plus the final minute (≥ 90, or the
 * last event minute if later). Second-half times are offset by 45'.
 */
export function buildXgTimeline(
  shots: readonly MatchEvent[],
  allEvents: readonly MatchEvent[],
): { minute: number; xg: number }[] {
  const lastMinute = allEvents.reduce((a, e) => Math.max(a, absMinute(e)), 0);
  const final = Math.max(90, Math.ceil(lastMinute));
  const minutes: number[] = [];
  for (let m = 0; m < final; m += 5) minutes.push(m);
  minutes.push(final);
  const sorted = shots.map((s) => ({ min: absMinute(s), xg: shotXg(s) })).sort((a, b) => a.min - b.min);
  return minutes.map((minute) => ({
    minute,
    xg: round(
      sorted.filter((s) => s.min <= minute || minute === final).reduce((a, s) => a + s.xg, 0),
      3,
    ),
  }));
}
