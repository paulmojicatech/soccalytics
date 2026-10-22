import type {
  BodyPart,
  EventType,
  Lineup,
  MatchEventInput,
  PlayPattern,
  Position,
  Team,
  TrackingDocument,
  TrackingFrame,
} from '@soccalytics/contracts';
import type { LatentAttributes, SimPlayer } from './attributes.js';
import { FORMATIONS, ROLE_PREFERENCES, selectLineup, type Slot } from './formation.js';
import { Rng } from './rng.js';
import { chanceQuality } from './shot-model.js';

export interface SimTeamInput {
  team: Team;
  players: SimPlayer[];
}

export interface SimulateMatchInput {
  matchId: string;
  seed: number;
  home: SimTeamInput;
  away: SimTeamInput;
  /** Tracking sample rate (frames per second). Default 5. */
  fps?: number;
}

export interface SimulateMatchResult {
  tracking: TrackingDocument;
  events: MatchEventInput[];
  lineups: Lineup[];
  homeScore: number;
  awayScore: number;
  durationSec: number;
}

type Side = 0 | 1;
interface P {
  x: number;
  y: number;
}

interface Agent {
  player: SimPlayer;
  attrs: LatentAttributes;
  side: Side;
  teamId: string;
  slot: number;
  role: Position;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onPitch: boolean;
  /** Top speed (m/s) when fresh. */
  maxSpeed: number;
  /** Ornstein–Uhlenbeck wander offset (team frame). */
  wx: number;
  wy: number;
  runUntil: number;
  run: P;
  /** Forced raw-frame target (receiving, intercepting, taking a restart). */
  override: { p: P; until: number; urgent: boolean } | null;
  beatenUntil: number;
  headerReady: boolean;
  enteredAt: number;
  leftAt: number | null;
}

type Restart = 'kickoff' | 'throw_in' | 'goal_kick' | 'corner' | 'free_kick' | 'penalty';

type BallState =
  | { kind: 'held'; carrier: Agent; decideAt: number; carry: { target: P; start: P; startT: number; speed: number; until: number } | null }
  | { kind: 'flight'; from: P; to: P; t0: number; t1: number; peak: number; onArrive: () => void }
  | { kind: 'dead'; restart: Restart; side: Side; spot: P; at: number; taker: Agent };

const L = 105;
const W = 68;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from point p to segment ab, plus the projection parameter. */
function segDist(p: P, a: P, b: P): { d: number; s: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const s = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { d: Math.hypot(p.x - (a.x + s * dx), p.y - (a.y + s * dy)), s };
}

const SHOT_ROLE_MULT: Record<Position, number> = { GK: 0, CB: 0.55, FB: 0.6, DM: 0.7, CM: 0.9, AM: 1.1, W: 1.05, ST: 1.1 };
const PERIOD_SECONDS = 45 * 60;

/**
 * Agent-based match engine. Positions are kept in raw pitch coordinates (home
 * attacks right in period 1); decisions are taken in each team's own frame
 * (attacking towards x = 105) and events are emitted in that frame.
 */
export class MatchEngine {
  private readonly rng: Rng;
  private readonly fps: number;
  private readonly dt: number;
  private readonly agents: Agent[] = [];
  private readonly slots: [readonly Slot[], readonly Slot[]];
  private readonly bench: [SimPlayer[], SimPlayer[]];
  private readonly subsPlan: { side: Side; at: number; offSlot: number; on: SimPlayer }[] = [];
  private readonly frames: TrackingFrame[] = [];
  private readonly events: (Omit<MatchEventInput, 'id'> & { seq: number })[] = [];
  private period = 1;
  private pt = 0;
  private periodOffset = 0;
  private ball = { x: L / 2, y: W / 2, z: 0 };
  private focus: P = { x: L / 2, y: W / 2 };
  private state!: BallState;
  private poss: Side = 0;
  private spellPressers = new Set<string>();
  /** Whether the defending team actively closes down the current carrier. */
  private spellPress = true;
  private chain: { start: number; pattern: PlayPattern } = { start: 0, pattern: 'open_play' };
  readonly score: [number, number] = [0, 0];
  private durationSec = 0;

  constructor(private readonly input: SimulateMatchInput) {
    this.rng = new Rng(input.seed >>> 0);
    this.fps = input.fps ?? 5;
    this.dt = 1 / this.fps;
    const selRng = this.rng.fork('lineups');
    const sel = [selectLineup(input.home.players, selRng), selectLineup(input.away.players, selRng)] as const;
    this.slots = [FORMATIONS[sel[0].formation], FORMATIONS[sel[1].formation]];
    this.bench = [sel[0].bench, sel[1].bench];
    ([0, 1] as const).forEach((side) => {
      const team = side === 0 ? input.home.team : input.away.team;
      for (const { player, slot } of sel[side].starters) this.agents.push(this.makeAgent(player, side, team.id, slot, 0));
      this.planSubs(side);
    });
  }

  private makeAgent(player: SimPlayer, side: Side, teamId: string, slot: number, now: number): Agent {
    const role = this.slots[side][slot]?.role ?? player.position;
    return {
      player,
      attrs: player.attributes,
      side,
      teamId,
      slot,
      role,
      x: L / 2,
      y: W / 2,
      vx: 0,
      vy: 0,
      onPitch: true,
      maxSpeed: 7.3 + (player.attributes.pace / 100) * 2.2,
      wx: 0,
      wy: 0,
      runUntil: -1,
      run: { x: 0, y: 0 },
      override: null,
      beatenUntil: -1,
      headerReady: false,
      enteredAt: now,
      leftAt: null,
    };
  }

  private planSubs(side: Side) {
    const n = this.rng.weightedIndex([0.1, 0.2, 0.3, 0.4]);
    const starters = this.agents.filter((a) => a.side === side && a.role !== 'GK');
    const order = starters
      .map((a) => ({ a, v: a.attrs.stamina + this.rng.normal(0, 10) }))
      .sort((p, q) => p.v - q.v)
      .map((x) => x.a);
    const bench = [...this.bench[side]];
    for (let i = 0; i < n && i < order.length; i++) {
      const off = order[i] as Agent;
      let onIdx = -1;
      for (const pos of ROLE_PREFERENCES[off.role]) {
        onIdx = bench.findIndex((p) => p.position === pos);
        if (onIdx >= 0) break;
      }
      if (onIdx < 0) onIdx = bench.findIndex((p) => p.position !== 'GK');
      if (onIdx < 0) continue;
      const on = bench.splice(onIdx, 1)[0] as SimPlayer;
      const minute = this.rng.range(58, 86);
      this.subsPlan.push({ side, at: minute * 60, offSlot: off.slot, on });
    }
    this.subsPlan.sort((a, b) => a.at - b.at);
  }

  // ---------------------------------------------------------------- frames
  private get clock(): number {
    return this.periodOffset + this.pt;
  }
  private dir(side: Side): 1 | -1 {
    const homeRight = this.period % 2 === 1;
    return (side === 0) === homeRight ? 1 : -1;
  }
  /** Raw ↔ team frame (rotation by 180°, an involution). */
  private tf(side: Side, p: P): P {
    return this.dir(side) === 1 ? { x: p.x, y: p.y } : { x: L - p.x, y: W - p.y };
  }
  private posT(a: Agent, side: Side = a.side): P {
    return this.tf(side, { x: a.x, y: a.y });
  }
  private onPitch(side?: Side): Agent[] {
    return this.agents.filter((a) => a.onPitch && (side === undefined || a.side === side));
  }
  private gk(side: Side): Agent | undefined {
    return this.agents.find((a) => a.onPitch && a.side === side && a.role === 'GK');
  }
  private teamOf(side: Side): Team {
    return side === 0 ? this.input.home.team : this.input.away.team;
  }

  // ---------------------------------------------------------------- events
  private emit(
    a: Agent,
    type: EventType,
    startRaw: P,
    endRaw: P,
    success: boolean,
    extra: { bodyPart?: BodyPart; playPattern?: PlayPattern; recipientId?: string | null } = {},
  ) {
    const s = this.tf(a.side, startRaw);
    const e = this.tf(a.side, endRaw);
    this.events.push({
      matchId: this.input.matchId,
      teamId: a.teamId,
      playerId: a.player.id,
      period: this.period,
      t: r2(this.pt),
      type,
      start: { x: r2(clamp(s.x, 0, L)), y: r2(clamp(s.y, 0, W)) },
      end: { x: r2(clamp(e.x, 0, L + 1)), y: r2(clamp(e.y, -1, W + 1)) },
      success,
      bodyPart: extra.bodyPart ?? 'foot',
      playPattern: extra.playPattern ?? 'open_play',
      recipientId: extra.recipientId ?? null,
      confidence: 1,
      seq: this.events.length,
    });
  }

  private patternFor(side: Side): PlayPattern {
    if (side !== this.poss) return 'open_play';
    const age = this.clock - this.chain.start;
    if (this.chain.pattern === 'set_piece' && age < 12) return 'set_piece';
    if (this.chain.pattern === 'counter' && age < 15) return 'counter';
    return 'open_play';
  }

  // ---------------------------------------------------------------- possession helpers
  private give(a: Agent, delay: [number, number], regain: boolean) {
    const prevPoss = this.poss;
    this.poss = a.side;
    if (regain || prevPoss !== a.side) {
      const x = this.posT(a).x;
      this.chain = { start: this.clock, pattern: x < 50 && a.role !== 'GK' ? 'counter' : 'open_play' };
      for (const o of this.agents) o.runUntil = -1;
    }
    a.override = null;
    this.spellPressers = new Set();
    const defSide: Side = a.side === 0 ? 1 : 0;
    const def = this.onPitch(defSide);
    const work = def.reduce((s, d) => s + d.attrs.workRate, 0) / Math.max(1, def.length);
    this.spellPress = this.rng.chance(0.2 + work / 250);
    this.state = { kind: 'held', carrier: a, decideAt: this.clock + this.rng.range(delay[0], delay[1]), carry: null };
  }

  private flight(from: P, to: P, speed: number, peak: number, onArrive: () => void) {
    const d = dist(from, to);
    const dur = Math.max(this.dt, d / speed);
    this.state = { kind: 'flight', from, to, t0: this.clock, t1: this.clock + dur, peak, onArrive };
    return dur;
  }

  private nearest(side: Side, p: P, exclude?: (a: Agent) => boolean): Agent | undefined {
    let best: Agent | undefined;
    let bd = Infinity;
    for (const a of this.onPitch(side)) {
      if (exclude?.(a)) continue;
      const d = dist(a, p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private send(a: Agent, p: P, until: number, urgent = true) {
    a.override = { p, until, urgent };
  }

  private restart(kind: Restart, side: Side, spot: P, delay: number) {
    const team = this.onPitch(side);
    let taker: Agent | undefined;
    if (kind === 'goal_kick') taker = this.gk(side);
    else if (kind === 'kickoff')
      taker = team.find((a) => a.role === 'ST') ?? team.find((a) => a.role === 'AM') ?? team.find((a) => a.role !== 'GK');
    else if (kind === 'corner' || kind === 'free_kick')
      taker = [...team].filter((a) => a.role !== 'GK').sort((a, b) => b.attrs.passing - a.attrs.passing || a.player.id.localeCompare(b.player.id))[0];
    else if (kind === 'penalty')
      taker = [...team].filter((a) => a.role !== 'GK').sort((a, b) => b.attrs.finishing - a.attrs.finishing || a.player.id.localeCompare(b.player.id))[0];
    else taker = this.nearest(side, spot, (a) => a.role === 'GK');
    taker ??= team[0] as Agent;
    this.poss = side;
    this.ball = { x: spot.x, y: spot.y, z: 0 };
    const at = this.clock + delay;
    this.state = { kind: 'dead', restart: kind, side, spot, at, taker };
    this.send(taker, spot, at, false);
    if (kind === 'penalty') {
      const keeper = this.gk(side === 0 ? 1 : 0);
      if (keeper) this.send(keeper, this.tf(side, { x: L - 0.5, y: W / 2 }), at, false);
    }
  }

  private kickoffSetup(side: Side) {
    for (const a of this.onPitch()) {
      const slot = this.slots[a.side][a.slot] as Slot;
      const t = { x: Math.min(slot.x * 0.85, 48), y: slot.y };
      const raw = this.tf(a.side, t);
      a.x = raw.x;
      a.y = raw.y;
      a.vx = 0;
      a.vy = 0;
      a.override = null;
      a.runUntil = -1;
    }
    this.restart('kickoff', side, { x: L / 2, y: W / 2 }, 0);
    const st = this.state as Extract<BallState, { kind: 'dead' }>;
    const tp = this.tf(side, { x: L / 2 - 0.6, y: W / 2 });
    st.taker.x = tp.x;
    st.taker.y = tp.y;
  }

  // ---------------------------------------------------------------- actions
  private takeRestart(st: Extract<BallState, { kind: 'dead' }>) {
    const c = st.taker;
    c.x = st.spot.x - 0.4 * this.dir(c.side);
    c.y = st.spot.y;
    c.vx = 0;
    c.vy = 0;
    this.give(c, [0, 0], false);
    this.chain = { start: this.clock, pattern: st.restart === 'kickoff' ? 'open_play' : 'set_piece' };
    const P = this.posT(c);
    switch (st.restart) {
      case 'kickoff':
        if (!this.pass(c, { maxDist: 25, backward: true, pattern: 'set_piece' })) this.startCarry(c);
        return;
      case 'throw_in':
        if (!this.pass(c, { maxDist: 22, pattern: 'set_piece', bodyPart: 'other' })) this.startCarry(c);
        return;
      case 'goal_kick':
        if (!this.pass(c, { pattern: 'set_piece', goalKick: true })) this.startCarry(c);
        return;
      case 'corner':
        this.cross(c, 'set_piece');
        return;
      case 'free_kick': {
        const q = chanceQuality(P.x, P.y, 'foot', 'set_piece');
        if (q > 0.035 && this.rng.chance(0.4)) this.shoot(c, 'set_piece', 'foot');
        else if (!this.pass(c, { pattern: 'set_piece' })) this.startCarry(c);
        return;
      }
      case 'penalty':
        this.shoot(c, 'penalty', 'foot');
        return;
    }
  }

  private decide(c: Agent) {
    const side = c.side;
    const P = this.posT(c);
    const opp = this.onPitch(side === 0 ? 1 : 0).map((o) => ({ a: o, p: this.posT(o, side) }));
    let nearestD = Infinity;
    let nearestOpp: Agent | undefined;
    for (const o of opp) {
      const d = dist(o.p, P);
      if (d < nearestD) {
        nearestD = d;
        nearestOpp = o.a;
      }
    }
    const att = c.attrs;
    const header = c.headerReady;
    c.headerReady = false;

    if (c.role === 'GK') {
      if (!this.pass(c, { goalKick: true, pattern: this.patternFor(side) })) this.startCarry(c);
      return;
    }
    // shoot?
    const bodyPart: BodyPart = header && this.rng.chance(0.75) ? 'head' : 'foot';
    const q = chanceQuality(P.x, P.y, bodyPart);
    let pShot =
      q >= 0.3 ? 0.7 : q >= 0.15 ? 0.45 : q >= 0.08 ? 0.24 : q >= 0.045 ? 0.1 : q >= 0.025 ? 0.035 : q >= 0.015 ? 0.008 : 0;
    pShot *= (0.6 + att.finishing / 125) * (SHOT_ROLE_MULT[c.role] ?? 1);
    // bodies in the shooting lane discourage the attempt
    const blockers = opp.filter((o) => o.a.role !== 'GK' && segDist(o.p, P, { x: L, y: 34 }).d < 1.8).length;
    pShot *= 0.6 ** blockers;
    if (header) pShot = Math.max(pShot, P.x > 90 ? 0.8 : 0);
    if (this.rng.chance(Math.min(0.95, pShot))) {
      this.shoot(c, this.patternFor(side), bodyPart);
      return;
    }
    // cross from wide areas of the final third
    if (P.x > 80 && (P.y < 15 || P.y > W - 15) && this.rng.chance(0.42)) {
      this.cross(c, this.patternFor(side));
      return;
    }
    // clear under pressure near own goal
    if (P.x < 22 && nearestD < 4 && ['CB', 'FB', 'DM'].includes(c.role) && this.rng.chance(0.5)) {
      this.clear(c);
      return;
    }
    // take on the nearest defender
    if (nearestOpp && nearestD < 2.6 && this.rng.chance(0.015 + att.dribbling / 1200 + (c.role === 'W' || c.role === 'AM' ? 0.04 : 0))) {
      this.dribble(c, nearestOpp);
      return;
    }
    // carry into space
    const blocked = opp.some((o) => o.p.x > P.x - 1 && dist(o.p, P) < 7);
    const carryBias = c.role === 'W' || c.role === 'FB' || c.role === 'AM' ? 0.06 : c.role === 'CB' ? -0.06 : 0;
    if (!blocked && this.rng.chance(0.13 + att.dribbling / 600 + carryBias)) {
      this.startCarry(c);
      return;
    }
    if (!this.pass(c, { pattern: this.patternFor(side) })) this.startCarry(c);
  }

  private startCarry(c: Agent, ahead?: number) {
    if (this.state.kind !== 'held' || this.state.carrier !== c) this.give(c, [0, 0], false);
    const st = this.state as Extract<BallState, { kind: 'held' }>;
    const P = this.posT(c);
    const fwd = ahead ?? this.rng.range(5, 15);
    const tgt = {
      x: clamp(P.x + fwd, 2, 101),
      y: clamp(P.y + this.rng.normal(0, 3.5) + (34 - P.y) * 0.1, 2, W - 2),
    };
    const speed = 4.6 + (c.attrs.pace / 100) * 2.2 + (c.attrs.dribbling / 100) * 0.5;
    st.carry = { target: this.tf(c.side, tgt), start: { x: this.ball.x, y: this.ball.y }, startT: this.clock, speed, until: this.clock + 4 };
    st.decideAt = Infinity;
  }

  private endCarry(c: Agent, st: Extract<BallState, { kind: 'held' }>) {
    if (!st.carry) return;
    const end = { x: this.ball.x, y: this.ball.y };
    if (dist(st.carry.start, end) >= 3) {
      const save = this.pt;
      // carry event is timestamped at its start
      this.pt = st.carry.startT - this.periodOffset;
      this.emit(c, 'carry', st.carry.start, end, true, { playPattern: this.patternFor(c.side) });
      this.pt = save;
    }
    st.carry = null;
  }

  private dribble(c: Agent, d: Agent) {
    const p = clamp(0.42 + (c.attrs.dribbling - d.attrs.tackling) / 110, 0.15, 0.85);
    const here = { x: c.x, y: c.y };
    if (this.rng.chance(p)) {
      this.emit(c, 'dribble', here, here, true, { playPattern: this.patternFor(c.side) });
      this.emit(d, 'tackle', here, here, false);
      d.beatenUntil = this.clock + 2;
      this.startCarry(c, this.rng.range(6, 10));
    } else {
      this.emit(c, 'dribble', here, here, false, { playPattern: this.patternFor(c.side) });
      this.emit(d, 'tackle', here, here, true);
      this.give(d, [0.5, 1.1], true);
    }
  }

  private pass(
    c: Agent,
    opts: { maxDist?: number; backward?: boolean; pattern?: PlayPattern; bodyPart?: BodyPart; goalKick?: boolean } = {},
  ): boolean {
    const side = c.side;
    const P = this.posT(c);
    const opp = this.onPitch(side === 0 ? 1 : 0).map((o) => this.posT(o, side));
    const mates = this.onPitch(side).filter((a) => a !== c);
    const vision = c.attrs.vision;
    const maxD = opts.maxDist ?? (c.role === 'GK' ? 70 : 42 + vision / 4);
    const cands: { a: Agent; p: P; d: number; space: number; lane: number; laneOpp: number; score: number }[] = [];
    for (const m of mates) {
      const mp = this.posT(m);
      const v = this.dir(side) === 1 ? { x: m.vx, y: m.vy } : { x: -m.vx, y: -m.vy };
      const lead = m.runUntil > this.clock ? 1.0 : 0.4;
      const p = { x: clamp(mp.x + v.x * lead, 1, 104), y: clamp(mp.y + v.y * lead, 1, W - 1) };
      const d = dist(P, p);
      if (d < 4 || d > maxD) continue;
      if (opts.backward && p.x > P.x) continue;
      if (m.role === 'GK' && (P.x > 40 || this.rng.chance(0.7))) continue;
      let space = 12;
      let lane = 8;
      let laneOpp = -1;
      opp.forEach((o, i) => {
        space = Math.min(space, dist(o, p));
        const sd = segDist(o, P, p);
        if (sd.s > 0.12 && sd.d < lane) {
          lane = sd.d;
          laneOpp = i;
        }
      });
      const progress = p.x - P.x;
      let score =
        0.022 * progress * (0.55 + vision / 100) +
        0.2 * Math.min(space, 8) +
        0.28 * Math.min(lane, 4) -
        0.075 * Math.max(0, d - 20) +
        (m.runUntil > this.clock ? 0.5 * (vision / 70) : 0) +
        (p.x > 88 && Math.abs(p.y - 34) < 18 ? 0.5 : 0);
      if (opts.goalKick && c.role === 'GK') score += m.role === 'CB' || m.role === 'FB' ? 0.8 : d > 40 ? 0.4 : 0;
      cands.push({ a: m, p, d, space, lane, laneOpp, score });
    }
    if (!cands.length) return false;
    const pick = cands[this.rng.weightedIndex(cands.map((k) => Math.exp(1.15 * k.score)))] as (typeof cands)[number];

    // success model
    const pressured = opp.some((o) => dist(o, P) < 2.5);
    let pSucc =
      0.94 +
      (c.attrs.passing - 60) * 0.0045 -
      0.0055 * Math.max(0, pick.d - 12) -
      0.13 * Math.max(0, 2.5 - pick.lane) / 2.5 -
      0.1 * Math.max(0, 3 - pick.space) / 3 -
      (pressured ? 0.06 : 0) -
      (pick.p.x > 75 && pick.p.x - P.x > 5 ? 0.07 : 0) -
      (pick.p.x > 88 && Math.abs(pick.p.y - 34) < 20 ? 0.12 : 0) -
      (pick.d > 35 ? 0.06 : 0);
    if (opts.pattern === 'set_piece' && opts.maxDist) pSucc += 0.06;
    pSucc = clamp(pSucc, 0.2, 0.985);
    const speed = clamp(9 + 0.3 * pick.d, 10, 24);
    const peak = pick.d > 28 ? 1.5 + pick.d / 15 : 0.1;
    const startRaw = { x: this.ball.x, y: this.ball.y };
    const pattern = opts.pattern ?? this.patternFor(side);
    const bodyPart = opts.bodyPart ?? 'foot';
    const roll = this.rng.next();
    const otherSide: Side = side === 0 ? 1 : 0;

    if (roll < pSucc) {
      const endRaw = this.tf(side, pick.p);
      this.emit(c, 'pass', startRaw, endRaw, true, { recipientId: pick.a.player.id, playPattern: pattern, bodyPart });
      const dur = this.flight(startRaw, endRaw, speed, peak, () => {
        const holdBase = pick.a.role === 'GK' ? [2.2, 4.5] : [1.8, 4.2];
        this.give(pick.a, holdBase as [number, number], false);
      });
      this.send(pick.a, endRaw, this.clock + dur, true);
      // nearest defender closes down the receiver
      const closer = this.nearest(otherSide, endRaw, (a) => a.role === 'GK');
      if (closer && dist(closer, endRaw) < 18) this.send(closer, endRaw, this.clock + dur + 0.5, dist(closer, endRaw) > 6);
      return true;
    }
    const laneAgent = pick.laneOpp >= 0 ? this.onPitch(otherSide)[pick.laneOpp] : undefined;
    const r = this.rng.next();
    if (laneAgent && pick.lane < 3 && r < 0.7) {
      // intercepted on the passing lane
      const lp = this.posT(laneAgent, side);
      const sd = segDist(lp, P, pick.p);
      const s = clamp(sd.s, 0.15, 0.95);
      const ip = { x: P.x + (pick.p.x - P.x) * s, y: P.y + (pick.p.y - P.y) * s };
      const endRaw = this.tf(side, ip);
      this.emit(c, 'pass', startRaw, endRaw, false, { playPattern: pattern, bodyPart });
      const dur = this.flight(startRaw, endRaw, speed, Math.min(peak, 1), () => {
        this.emit(laneAgent, 'interception', endRaw, endRaw, true);
        this.give(laneAgent, [0.5, 1.2], true);
      });
      this.send(laneAgent, endRaw, this.clock + dur, true);
      return true;
    }
    if (r < 0.72 || pick.p.x > 100) {
      // loose ball won by the opponent
      const ang = this.rng.range(0, Math.PI * 2);
      const rad = this.rng.range(3, 9);
      const lp = { x: clamp(pick.p.x + Math.cos(ang) * rad, 1, 103), y: clamp(pick.p.y + Math.sin(ang) * rad, 1, W - 1) };
      const endRaw = this.tf(side, lp);
      this.emit(c, 'pass', startRaw, endRaw, false, { playPattern: pattern, bodyPart });
      const rec = this.nearest(otherSide, endRaw) as Agent;
      const dur = this.flight(startRaw, endRaw, speed, peak, () => {
        this.emit(rec, 'recovery', endRaw, endRaw, true);
        this.give(rec, [0.6, 1.3], true);
      });
      this.send(rec, endRaw, this.clock + dur + 0.4, true);
      return true;
    }
    // out of play over the touchline → throw-in
    const edgeY = pick.p.y < W / 2 ? -0.4 : W + 0.4;
    const lp = { x: clamp(pick.p.x + this.rng.normal(0, 3), 1, 104), y: edgeY };
    const endRaw = this.tf(side, lp);
    this.emit(c, 'pass', startRaw, endRaw, false, { playPattern: pattern, bodyPart });
    this.flight(startRaw, endRaw, speed, peak, () => {
      const spot = this.tf(side, { x: lp.x, y: edgeY < 0 ? 0 : W });
      this.restart('throw_in', otherSide, spot, this.rng.range(9, 16));
    });
    return true;
  }

  private cross(c: Agent, pattern: PlayPattern) {
    const side = c.side;
    const otherSide: Side = side === 0 ? 1 : 0;
    const tgtT = { x: this.rng.range(92, 101), y: this.rng.range(26, 42) };
    const tgt = this.tf(side, tgtT);
    const startRaw = { x: this.ball.x, y: this.ball.y };
    const receiver = this.nearest(side, tgt, (a) => a === c || a.role === 'GK' || a.role === 'CB');
    const p = receiver ? clamp(0.2 + (c.attrs.passing - 55) / 250 + (receiver.attrs.aerial - 55) / 350, 0.08, 0.45) : 0;
    const speed = 18;
    const peak = 3.5;
    const isSet = pattern === 'set_piece';
    if (receiver && this.rng.chance(p)) {
      this.emit(c, 'cross', startRaw, tgt, true, { recipientId: receiver.player.id, playPattern: pattern });
      const dur = this.flight(startRaw, tgt, speed, peak, () => {
        this.give(receiver, [0.12, 0.35], false);
        receiver.headerReady = true;
        if (isSet) this.chain = { start: this.clock, pattern: 'set_piece' };
      });
      this.send(receiver, tgt, this.clock + dur, true);
      return;
    }
    const r = this.rng.next();
    const keeper = this.gk(otherSide);
    if (r < 0.62 || !keeper) {
      const def = this.nearest(otherSide, tgt, (a) => a.role === 'GK') as Agent;
      const dp = this.posT(def, side);
      const endT = { x: clamp(dp.x, 80, 103), y: clamp(dp.y, 15, 53) };
      const endRaw = this.tf(side, endT);
      this.emit(c, 'cross', startRaw, endRaw, false, { playPattern: pattern });
      const dur = this.flight(startRaw, endRaw, speed, peak, () => {
        def.x = endRaw.x;
        def.y = endRaw.y;
        this.give(def, [0, 0], true);
        this.clear(def);
      });
      this.send(def, endRaw, this.clock + dur, true);
    } else if (r < 0.85) {
      const kp = this.posT(keeper, side);
      const endRaw = this.tf(side, { x: clamp(kp.x - 3, 94, 103), y: clamp(kp.y, 26, 42) });
      this.emit(c, 'cross', startRaw, endRaw, false, { playPattern: pattern });
      const dur = this.flight(startRaw, endRaw, speed, peak, () => {
        this.emit(keeper, 'recovery', endRaw, endRaw, true);
        this.give(keeper, [2, 5], true);
      });
      this.send(keeper, endRaw, this.clock + dur, true);
    } else {
      const endT = { x: 105.5, y: this.rng.chance(0.5) ? this.rng.range(10, 28) : this.rng.range(40, 58) };
      const endRaw = this.tf(side, endT);
      this.emit(c, 'cross', startRaw, endRaw, false, { playPattern: pattern });
      this.flight(startRaw, endRaw, speed, peak, () => {
        if (this.rng.chance(0.5)) this.restart('goal_kick', otherSide, this.tf(otherSide, { x: 5.5, y: this.rng.chance(0.5) ? 25 : 43 }), this.rng.range(15, 24));
        else this.cornerFor(side, endT.y);
      });
    }
  }

  private cornerFor(side: Side, nearY: number) {
    const spot = this.tf(side, { x: L, y: nearY < W / 2 ? 0 : W });
    this.restart('corner', side, spot, this.rng.range(22, 34));
  }

  private clear(d: Agent) {
    const side = d.side;
    const P = this.posT(d);
    const endT = { x: clamp(P.x + this.rng.range(28, 50), 30, 95), y: this.rng.range(4, W - 4) };
    const startRaw = { x: this.ball.x, y: this.ball.y };
    const endRaw = this.tf(side, endT);
    this.emit(d, 'clearance', startRaw, endRaw, true);
    const otherSide: Side = side === 0 ? 1 : 0;
    const dur = this.flight(startRaw, endRaw, 20, 7, () => {
      if (this.rng.chance(0.12)) {
        const spot = this.tf(side, { x: endT.x, y: endT.y < W / 2 ? 0 : W });
        this.restart('throw_in', otherSide, spot, this.rng.range(9, 16));
        return;
      }
      const cand = this.onPitch()
        .filter((a) => a.role !== 'GK')
        .map((a) => ({ a, d: dist(a, endRaw) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 4);
      const w = cand.map((k) => 1 / (k.d + 1.5) ** 2 * (0.6 + k.a.attrs.aerial / 100));
      const winner = (cand[this.rng.weightedIndex(w)] ?? cand[0])?.a as Agent;
      this.emit(winner, 'recovery', endRaw, endRaw, true);
      this.give(winner, [0.5, 1.2], winner.side !== this.poss);
    });
    for (const s of [0, 1] as const) {
      const n = this.nearest(s, endRaw, (a) => a.role === 'GK');
      if (n) this.send(n, endRaw, this.clock + dur, true);
    }
  }

  private shoot(c: Agent, pattern: PlayPattern, bodyPart: BodyPart) {
    const side = c.side;
    const otherSide: Side = side === 0 ? 1 : 0;
    const P = this.posT(c);
    const q = chanceQuality(P.x, P.y, bodyPart, pattern);
    const keeper = this.gk(otherSide);
    const fin = c.attrs.finishing;
    const gkFactor = keeper ? 1.25 - keeper.attrs.positioning / 200 : 1.3;
    const pGoal =
      pattern === 'penalty' ? clamp(0.62 + fin / 400 + (gkFactor - 0.93) * 0.3, 0.55, 0.92) : clamp(q * (0.32 + fin / 100) * gkFactor, 0.004, 0.95);
    const pOn = Math.max(pGoal + 0.04, 0.2 + fin / 330 - (bodyPart === 'head' ? 0.05 : 0));
    const r = this.rng.next();
    const startRaw = { x: this.ball.x, y: this.ball.y };
    const speed = bodyPart === 'head' ? 13 : 24;
    const sideY = this.rng.chance(0.5) ? 1 : -1;
    if (r < pGoal) {
      const endT = { x: L, y: 34 + sideY * this.rng.range(0, 3.2) };
      this.emit(c, 'shot', startRaw, this.tf(side, endT), true, { playPattern: pattern, bodyPart });
      const ballEnd = this.tf(side, { x: L + 0.8, y: endT.y });
      this.flight(startRaw, ballEnd, speed, 0.8, () => {
        this.score[side]++;
        this.restart('kickoff', otherSide, { x: L / 2, y: W / 2 }, this.rng.range(35, 50));
      });
      return;
    }
    if (r < pOn && keeper) {
      const endT = { x: L - 0.3, y: 34 + sideY * this.rng.range(0, 3.3) };
      const endRaw = this.tf(side, endT);
      this.emit(c, 'shot', startRaw, endRaw, false, { playPattern: pattern, bodyPart });
      const dur = this.flight(startRaw, endRaw, speed, 0.9, () => {
        const kp = this.tf(side, { x: endT.x - 0.6, y: endT.y });
        keeper.x = kp.x;
        keeper.y = kp.y;
        const kpos = { x: keeper.x, y: keeper.y };
        this.emit(keeper, 'save', kpos, kpos, true);
        if (this.rng.chance(0.3)) this.cornerFor(side, endT.y);
        else this.give(keeper, [3, 7], true);
      });
      this.send(keeper, endRaw, this.clock + dur, true);
      return;
    }
    if (this.rng.chance(0.38)) {
      // blocked
      const s = this.rng.range(0.15, 0.4);
      const g = { x: L, y: 34 };
      const bT = { x: P.x + (g.x - P.x) * s, y: P.y + (g.y - P.y) * s };
      const bRaw = this.tf(side, bT);
      this.emit(c, 'shot', startRaw, bRaw, false, { playPattern: pattern, bodyPart });
      const blocker = this.nearest(otherSide, bRaw, (a) => a.role === 'GK') as Agent;
      const dur = this.flight(startRaw, bRaw, speed, 0.4, () => {
        if (this.rng.chance(0.35)) this.cornerFor(side, bT.y);
        else {
          this.emit(blocker, 'recovery', bRaw, bRaw, true);
          this.give(blocker, [0.4, 1.0], true);
        }
      });
      this.send(blocker, bRaw, this.clock + dur, true);
      return;
    }
    const endT = { x: L + 0.5, y: 34 + sideY * this.rng.range(4.2, 13) };
    const endRaw = this.tf(side, endT);
    this.emit(c, 'shot', startRaw, endRaw, false, { playPattern: pattern, bodyPart });
    this.flight(startRaw, endRaw, speed, 2.2, () => {
      this.restart('goal_kick', otherSide, this.tf(otherSide, { x: 5.5, y: endT.y < 34 ? 43 : 25 }), this.rng.range(15, 25));
    });
  }

  // ---------------------------------------------------------------- per-frame logic
  private onBallFrame() {
    const st = this.state;
    if (st.kind === 'dead') {
      if (this.clock >= st.at) {
        this.applySubs();
        if (st.taker.onPitch) this.takeRestart(st);
        else {
          const taker = this.nearest(st.side, st.spot) as Agent;
          this.takeRestart({ ...st, taker });
        }
      }
      return;
    }
    if (st.kind === 'flight') {
      if (this.clock >= st.t1 - 1e-9) st.onArrive();
      return;
    }
    // held
    const c = st.carrier;
    const P = { x: c.x, y: c.y };
    const otherSide: Side = c.side === 0 ? 1 : 0;
    for (const o of this.onPitch(otherSide)) {
      const d = dist(o, P);
      if (d <= 3 && !this.spellPressers.has(o.player.id) && o.role !== 'GK') {
        this.spellPressers.add(o.player.id);
        // only deliberate closing-down counts as a pressure action
        if (this.rng.chance(0.25 + o.attrs.workRate / 500)) this.emit(o, 'pressure', P, P, true);
        if (st.decideAt - this.clock > 1.0 && !st.carry && this.rng.chance(0.5)) st.decideAt = this.clock + this.rng.range(0.5, 1.0);
      }
      if (d <= 1.7 && o.beatenUntil < this.clock && o.role !== 'GK') {
        if (this.rng.chance(0.02 * (o.attrs.workRate / 70) * this.dt)) {
          this.foul(o, c, st);
          return;
        }
        const rate = 0.09 * (0.4 + o.attrs.tackling / 100) * (0.6 + o.attrs.workRate / 160);
        if (this.rng.chance(rate * this.dt)) {
          this.tackleAttempt(o, c, st);
          return;
        }
      }
    }
    if (st.carry) {
      const reached = dist(P, st.carry.target) < 1 || this.clock >= st.carry.until;
      const pressed = this.onPitch(otherSide).some((o) => dist(o, P) < 1.8);
      if (reached || (pressed && this.clock - st.carry.startT > 1.0)) {
        this.endCarry(c, st);
        st.decideAt = this.clock + this.rng.range(0.1, 0.5);
      }
      return;
    }
    if (this.clock >= st.decideAt) this.decide(c);
  }

  private foul(d: Agent, c: Agent, st: Extract<BallState, { kind: 'held' }>) {
    this.endCarry(c, st);
    const here = { x: c.x, y: c.y };
    const cT = this.posT(c);
    const inBox = cT.x > L - 16.5 && Math.abs(cT.y - 34) < 20.16;
    this.emit(d, 'foul', here, here, false);
    if (inBox) this.restart('penalty', c.side, this.tf(c.side, { x: L - 11, y: 34 }), this.rng.range(40, 60));
    else this.restart('free_kick', c.side, here, this.rng.range(16, 30));
  }

  private tackleAttempt(d: Agent, c: Agent, st: Extract<BallState, { kind: 'held' }>) {
    this.endCarry(c, st);
    const here = { x: c.x, y: c.y };
    const cT = this.posT(c);
    const inBox = cT.x > L - 16.5 && Math.abs(cT.y - 34) < 20.16;
    if (this.rng.chance(inBox ? 0.05 : 0.15)) {
      this.foul(d, c, st);
      return;
    }
    const p = clamp(0.5 + (d.attrs.tackling - c.attrs.dribbling) / 160, 0.2, 0.85);
    if (this.rng.chance(p)) {
      this.emit(d, 'tackle', here, here, true);
      this.give(d, [0.5, 1.1], true);
    } else {
      this.emit(d, 'tackle', here, here, false);
      this.emit(c, 'dribble', here, here, true, { playPattern: this.patternFor(c.side) });
      d.beatenUntil = this.clock + 2.5;
      this.startCarry(c, this.rng.range(5, 9));
    }
  }

  private applySubs() {
    while (this.subsPlan.length && (this.subsPlan[0] as (typeof this.subsPlan)[number]).at <= this.clock) {
      const s = this.subsPlan.shift() as (typeof this.subsPlan)[number];
      const off = this.agents.find((a) => a.onPitch && a.side === s.side && a.slot === s.offSlot);
      if (!off) continue;
      off.onPitch = false;
      off.leftAt = this.clock;
      const on = this.makeAgent(s.on, s.side, off.teamId, off.slot, this.clock);
      on.x = off.x;
      on.y = off.y;
      this.agents.push(on);
      if (this.state.kind === 'dead' && this.state.taker === off) this.state.taker = on;
    }
  }

  private targetFor(a: Agent): { p: P; urgent: boolean; cap?: number } {
    if (a.override && a.override.until >= this.clock) return { p: a.override.p, urgent: a.override.urgent };
    a.override = null;
    const st = this.state;
    if (st.kind === 'held' && st.carrier === a) {
      if (st.carry) return { p: st.carry.target, urgent: false, cap: st.carry.speed };
      const fwd = this.tf(a.side, { x: clamp(this.posT(a).x + 2, 1, 104), y: this.posT(a).y });
      return { p: fwd, urgent: false, cap: 1.4 };
    }
    const side = a.side;
    const ballT = this.tf(side, this.focus);
    const slot = this.slots[side][a.slot] as Slot;
    const inPoss = this.poss === side;
    let tx: number;
    let ty: number;
    if (a.role === 'GK') {
      tx = clamp(4 + Math.max(0, ballT.x - 20) * 0.17 + a.wx * 0.5, 2, 22);
      ty = 34 + (ballT.y - 34) * 0.22 + a.wy * 0.5;
    } else {
      const shift = (ballT.x - 52.5) * 0.45;
      if (inPoss) {
        tx = slot.x + shift + 5;
        ty = 34 + (slot.y - 34) * 1.12 + (ballT.y - 34) * 0.22;
      } else {
        tx = slot.x + shift * 0.9 - 7;
        ty = 34 + (slot.y - 34) * 0.72 + (ballT.y - 34) * 0.38;
      }
      tx += a.wx;
      ty += a.wy;
      if (st.kind === 'dead' && st.restart === 'kickoff') tx = Math.min(tx, 50);
      if (inPoss && a.runUntil > this.clock) {
        tx = a.run.x;
        ty = a.run.y;
        return { p: this.tf(side, { x: clamp(tx, 1.5, 103.5), y: clamp(ty, 1.5, W - 1.5) }), urgent: true };
      }
    }
    return { p: this.tf(side, { x: clamp(tx, 1.5, 103.5), y: clamp(ty, 1.5, W - 1.5) }), urgent: false };
  }

  private movePlayers() {
    const dt = this.dt;
    const st = this.state;
    const pressers = new Map<Agent, P>();
    // pressing: nearest 1–2 defenders close down the carrier
    if (st.kind === 'held') {
      const c = st.carrier;
      const defSide: Side = c.side === 0 ? 1 : 0;
      const defs = this.onPitch(defSide)
        .filter((a) => a.role !== 'GK' && !a.override)
        .map((a) => ({ a, d: dist(a, c) }))
        .sort((p, q) => p.d - q.d);
      const work = defs.length ? defs.reduce((s, k) => s + k.a.attrs.workRate, 0) / defs.length : 60;
      const range = 9 + work / 7;
      const first = defs[0];
      const own = this.tf(defSide, { x: 0, y: W / 2 });
      const toOwn = (m: number) => {
        const k = m / Math.max(m, dist(c, own));
        return { x: c.x + (own.x - c.x) * k, y: c.y + (own.y - c.y) * k };
      };
      if (first && first.d < range) pressers.set(first.a, toOwn(this.spellPress ? 1.1 : 4.5));
      const second = defs[1];
      if (second && second.d < range * 0.75) pressers.set(second.a, toOwn(4));
    }
    const progress = Math.min(1, this.clock / 5700);
    for (const a of this.agents) {
      if (!a.onPitch) continue;
      // wander (OU process, sd ≈ 3 m)
      a.wx += -a.wx * 0.15 * dt + 1.0 * Math.sqrt(dt) * this.rng.normal();
      a.wy += -a.wy * 0.15 * dt + 1.0 * Math.sqrt(dt) * this.rng.normal();
      // attacking runs
      if (st.kind !== 'dead' && this.poss === a.side && a.runUntil < this.clock && ['W', 'ST', 'AM', 'FB', 'CM'].includes(a.role)) {
        const ballT = this.tf(a.side, this.ball);
        const rate = (a.role === 'FB' || a.role === 'CM' ? 0.006 : 0.015) * (a.attrs.workRate / 65);
        if (ballT.x > 40 && this.rng.chance(rate * dt)) {
          const mine = this.posT(a);
          a.run = { x: clamp(Math.max(mine.x, ballT.x) + this.rng.range(10, 22), 50, 100), y: clamp(mine.y + (34 - mine.y) * 0.35 + this.rng.normal(0, 4), 3, W - 3) };
          a.runUntil = this.clock + this.rng.range(2.5, 4.5);
        }
      }
      let tgt = this.targetFor(a);
      const press = pressers.get(a);
      if (press) {
        const d0 = dist(a, press);
        const intensity = a.attrs.workRate / 100;
        tgt = { p: press, urgent: d0 > 7 && intensity > 0.55, cap: d0 > 7 ? undefined : 3 };
      }
      // recovery runs when far out of position after losing the ball
      const dx = tgt.p.x - a.x;
      const dy = tgt.p.y - a.y;
      const d = Math.hypot(dx, dy);
      const fatigue = 1 - 0.12 * progress * (1.15 - a.attrs.stamina / 100);
      const vmax = a.maxSpeed * fatigue;
      let cap: number;
      if (tgt.cap !== undefined) cap = Math.min(tgt.cap, vmax);
      else if (tgt.urgent) cap = vmax;
      else cap = d > 22 ? 0.8 * vmax : d > 10 ? 4.4 : d > 4 ? 2.8 : 1.4;
      if (a.role === 'GK' && !tgt.urgent) cap = Math.min(cap, 3.2);
      const desired = Math.min(cap, d * 1.2);
      const dvx = (d > 1e-6 ? (dx / d) * desired : 0) - a.vx;
      const dvy = (d > 1e-6 ? (dy / d) * desired : 0) - a.vy;
      const dv = Math.hypot(dvx, dvy);
      const amax = (tgt.urgent ? 6 : 4) * dt;
      const k = dv > amax ? amax / dv : 1;
      a.vx += dvx * k;
      a.vy += dvy * k;
      a.x = clamp(a.x + a.vx * dt, -1, L + 1);
      a.y = clamp(a.y + a.vy * dt, -1, W + 1);
    }
  }

  private updateBall() {
    const st = this.state;
    // players react to a smoothed ball location, not to every frame of a pass
    const k = Math.min(1, this.dt / 1.2);
    this.focus = { x: this.focus.x + (this.ball.x - this.focus.x) * k, y: this.focus.y + (this.ball.y - this.focus.y) * k };
    if (st.kind === 'held') {
      const c = st.carrier;
      const sp = Math.hypot(c.vx, c.vy);
      const ux = sp > 0.5 ? c.vx / sp : this.dir(c.side);
      const uy = sp > 0.5 ? c.vy / sp : 0;
      this.ball = { x: c.x + ux * 0.45, y: c.y + uy * 0.45, z: 0 };
    } else if (st.kind === 'flight') {
      const s = clamp((this.clock - st.t0) / Math.max(1e-6, st.t1 - st.t0), 0, 1);
      this.ball = {
        x: st.from.x + (st.to.x - st.from.x) * s,
        y: st.from.y + (st.to.y - st.from.y) * s,
        z: 4 * st.peak * s * (1 - s),
      };
    }
  }

  private recordFrame() {
    const players: TrackingFrame['players'] = [];
    for (const a of this.agents)
      if (a.onPitch) players.push({ playerId: a.player.id, teamId: a.teamId, x: r2(a.x), y: r2(a.y) });
    this.frames.push({
      period: this.period,
      t: r2(this.pt),
      ball: { x: r2(this.ball.x), y: r2(this.ball.y), z: r2(this.ball.z) },
      players,
    });
  }

  // ---------------------------------------------------------------- run
  run(): SimulateMatchResult {
    for (const period of [1, 2]) {
      this.period = period;
      this.pt = 0;
      const stoppage = Math.round(this.rng.range(period === 1 ? 45 : 120, period === 1 ? 150 : 300));
      const len = PERIOD_SECONDS + stoppage;
      this.kickoffSetup(period === 1 ? 0 : 1);
      const n = Math.round(len * this.fps);
      for (let f = 0; f < n; f++) {
        this.pt = f * this.dt;
        this.onBallFrame();
        // guard: actions resolving instantly (e.g. restart → pass) are processed in the same frame
        this.movePlayers();
        this.updateBall();
        this.recordFrame();
      }
      this.periodOffset += len;
      this.durationSec += len;
    }
    return this.result();
  }

  private result(): SimulateMatchResult {
    const { matchId } = this.input;
    const sorted = [...this.events].sort((a, b) => a.period - b.period || a.t - b.t || a.seq - b.seq);
    const events: MatchEventInput[] = sorted.map((e, i) => {
      const out: MatchEventInput & { seq?: number } = { id: `${matchId}-ev-${i}`, ...e };
      delete out.seq;
      return out;
    });
    const fullMinutes = 90;
    const toMinute = (clock: number) => {
      // map engine clock (with stoppage) to the nominal 90-minute match clock
      const p1 = this.frames.filter((f) => f.period === 1).length / this.fps;
      if (clock <= p1) return Math.min(45, clock / 60);
      return Math.min(90, 45 + (clock - p1) / 60);
    };
    const lineups: Lineup[] = this.agents.map((a) => {
      const start = a.enteredAt > 0 ? toMinute(a.enteredAt) : 0;
      const end = a.leftAt != null ? toMinute(a.leftAt) : fullMinutes;
      return {
        matchId,
        teamId: a.teamId,
        playerId: a.player.id,
        starter: a.enteredAt === 0,
        minutesPlayed: Math.round((end - start) * 10) / 10,
        position: a.role,
      };
    });
    for (const side of [0, 1] as const) {
      for (const p of this.input[side === 0 ? 'home' : 'away'].players) {
        if (!lineups.some((l) => l.playerId === p.id)) {
          lineups.push({ matchId, teamId: this.teamOf(side).id, playerId: p.id, starter: false, minutesPlayed: 0, position: p.position });
        }
      }
    }
    return {
      tracking: {
        meta: {
          matchId,
          fps: this.fps,
          frameCount: this.frames.length,
          homeTeamId: this.input.home.team.id,
          awayTeamId: this.input.away.team.id,
          homeAttacksRight: [true, false],
          source: 'simulation',
        },
        frames: this.frames,
      },
      events,
      lineups,
      homeScore: this.score[0],
      awayScore: this.score[1],
      durationSec: Math.round(this.durationSec),
    };
  }
}

/** Simulate a full 90-minute match (+ stoppage time) deterministically from `seed`. */
export function simulateMatch(input: SimulateMatchInput): SimulateMatchResult {
  return new MatchEngine(input).run();
}
