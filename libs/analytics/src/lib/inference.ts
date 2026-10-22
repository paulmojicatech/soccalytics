import { GOAL_CENTER, GOAL_WIDTH, PITCH, type MatchEventInput, type Point, type TrackingDocument } from '@soccalytics/contracts';
import { distance } from './geometry.js';
import { round } from './math.js';

export interface InferenceOptions {
  /** Max player–ball distance (m) to be considered in control. */
  possessionRadius?: number;
  /** Consecutive frames a player must be nearest to the ball to take possession. */
  minControlFrames?: number;
  /** Minimum ball displacement within one possession to emit a carry. */
  carryMinDistance?: number;
  /** Opponent distance (m) to the carrier that counts as pressure. */
  pressureRadius?: number;
  /** Minimum speed (m/s) at which a presser must be closing the gap to the carrier. */
  pressureClosingSpeed?: number;
  /** Minimum release speed (m/s) for a ball movement to be considered a shot. */
  shotMinSpeed?: number;
}

interface Segment {
  playerId: string;
  teamId: string;
  period: number;
  i0: number;
  i1: number;
}

/**
 * Infer SPADL-style on-ball events from raw positional tracking — the CV path
 * where nothing is hand-tagged. Heuristics (possession-chain segmentation):
 *
 *  1. Ball control: the nearest player within ~1.5 m of the ball for at least
 *     `minControlFrames` consecutive frames owns it. Consecutive spells by the
 *     same player are merged.
 *  2. Within a spell: ball displacement ≥ 5 m ⇒ carry; an opponent within
 *     3 m of the carrier *and closing in* (≥ 1.5 m/s) ⇒ one pressure event
 *     per presser.
 *  3. Between spells:
 *     - fast release (≥ 12 m/s) towards goal that reaches the goal line area
 *       ⇒ shot (successful if it crosses the line between the posts);
 *     - next owner is a teammate ⇒ completed pass (cross if from a wide area
 *       of the final third into the box);
 *     - next owner is an opponent: ball travelled ≥ 3 m ⇒ failed pass +
 *       interception (or recovery if the ball was loose > 2.5 s); otherwise
 *       the ball was won at the feet ⇒ tackle.
 *
 * Coordinates are normalised per period with `meta.homeAttacksRight` so the
 * acting team attacks towards x = 105. Confidence is < 1 to reflect the
 * heuristic nature of the detections.
 */
export function inferEventsFromTracking(doc: TrackingDocument, opts: InferenceOptions = {}): MatchEventInput[] {
  const { meta, frames } = doc;
  const fps = meta.fps > 0 ? meta.fps : 10;
  const radius = opts.possessionRadius ?? 1.5;
  const minFrames = opts.minControlFrames ?? Math.max(2, Math.round(fps * 0.3));
  const carryMin = opts.carryMinDistance ?? 5;
  const pressureR = opts.pressureRadius ?? 3;
  const closingSpeed = opts.pressureClosingSpeed ?? 1.5;
  const shotSpeed = opts.shotMinSpeed ?? 12;
  const maxGapFrames = Math.round(fps * 8);

  const attacksRight = (teamId: string, period: number): boolean => {
    const home = meta.homeAttacksRight[period - 1] ?? period % 2 === 1;
    return teamId === meta.homeTeamId ? home : !home;
  };
  const norm = (teamId: string, period: number, p: Point): Point => {
    const q = attacksRight(teamId, period) ? p : { x: PITCH.length - p.x, y: PITCH.width - p.y };
    return { x: round(q.x, 2), y: round(q.y, 2) };
  };

  // 1. nearest-player candidate per frame
  const cand: ({ playerId: string; teamId: string } | null)[] = frames.map((f) => {
    if (!f.ball || (f.ball.z ?? 0) > 2) return null;
    let best: { playerId: string; teamId: string } | null = null;
    let bestD = radius;
    for (const p of f.players) {
      const d = Math.hypot(p.x - f.ball.x, p.y - f.ball.y);
      if (d <= bestD) {
        bestD = d;
        best = { playerId: p.playerId, teamId: p.teamId };
      }
    }
    return best;
  });

  // 2. runs → possession segments
  const segments: Segment[] = [];
  let i = 0;
  while (i < frames.length) {
    const c = cand[i];
    if (!c) {
      i++;
      continue;
    }
    const period = (frames[i] as (typeof frames)[number]).period;
    let j = i;
    while (j + 1 < frames.length && cand[j + 1]?.playerId === c.playerId && frames[j + 1]?.period === period) j++;
    if (j - i + 1 >= minFrames) {
      const last = segments[segments.length - 1];
      if (last && last.playerId === c.playerId && last.period === period && i - last.i1 <= maxGapFrames) last.i1 = j;
      else segments.push({ playerId: c.playerId, teamId: c.teamId, period, i0: i, i1: j });
    }
    i = j + 1;
  }

  const ballAt = (idx: number): Point => {
    const b = frames[idx]?.ball;
    return b ? { x: b.x, y: b.y } : { x: PITCH.length / 2, y: PITCH.width / 2 };
  };
  const out: { ev: Omit<MatchEventInput, 'id'>; order: number }[] = [];
  const push = (e: Omit<MatchEventInput, 'id' | 'matchId'>) =>
    out.push({ ev: { ...e, matchId: meta.matchId }, order: out.length });

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s] as Segment;
    const f0 = frames[seg.i0] as (typeof frames)[number];
    const f1 = frames[seg.i1] as (typeof frames)[number];

    // pressure on the carrier
    const pressed = new Set<string>();
    for (let k = Math.max(seg.i0, 1); k <= seg.i1; k++) {
      const f = frames[k] as (typeof frames)[number];
      const prevF = frames[k - 1] as (typeof frames)[number];
      const carrier = f.players.find((p) => p.playerId === seg.playerId);
      const prevCarrier = prevF.players.find((p) => p.playerId === seg.playerId);
      if (!carrier || !prevCarrier) continue;
      const dtF = Math.max(1e-3, f.t - prevF.t);
      for (const p of f.players) {
        if (p.teamId === seg.teamId || pressed.has(p.playerId)) continue;
        const d = Math.hypot(p.x - carrier.x, p.y - carrier.y);
        if (d > pressureR) continue;
        const prev = prevF.players.find((q) => q.playerId === p.playerId);
        const closing = prev ? (Math.hypot(prev.x - prevCarrier.x, prev.y - prevCarrier.y) - d) / dtF : 0;
        if (closing >= closingSpeed) {
          pressed.add(p.playerId);
          const loc = norm(p.teamId, seg.period, carrier);
          push({
            teamId: p.teamId,
            playerId: p.playerId,
            period: seg.period,
            t: round(f.t, 2),
            type: 'pressure',
            start: loc,
            end: loc,
            success: true,
            confidence: 0.6,
          });
        }
      }
    }

    // carry
    const b0 = ballAt(seg.i0);
    const b1 = ballAt(seg.i1);
    if (distance(b0, b1) >= carryMin) {
      push({
        teamId: seg.teamId,
        playerId: seg.playerId,
        period: seg.period,
        t: round(f0.t, 2),
        type: 'carry',
        start: norm(seg.teamId, seg.period, b0),
        end: norm(seg.teamId, seg.period, b1),
        success: true,
        confidence: 0.7,
      });
    }

    // transition to next possession
    const next = segments[s + 1];
    const sameWindow = next && next.period === seg.period && next.i0 - seg.i1 <= maxGapFrames;
    const relIdx = Math.min(seg.i1 + 1, frames.length - 1);
    const lastIdx = sameWindow ? next.i0 : Math.min(seg.i1 + maxGapFrames, frames.length - 1);

    // shot detection
    const release = norm(seg.teamId, seg.period, b1);
    const rel2 = norm(seg.teamId, seg.period, ballAt(relIdx));
    const relDt = Math.max(1 / fps, ((frames[relIdx]?.t ?? f1.t) - f1.t) || 1 / fps);
    const relSpeed = distance(release, rel2) / relDt;
    let maxX = -Infinity;
    let goal = false;
    let shotEnd: Point | null = null;
    for (let k = seg.i1 + 1; k <= lastIdx; k++) {
      const fb = frames[k]?.ball;
      if (!fb || frames[k]?.period !== seg.period) break;
      const q = norm(seg.teamId, seg.period, fb);
      if (q.x > maxX) {
        maxX = q.x;
        shotEnd = q;
      }
      if (q.x >= PITCH.length && Math.abs(q.y - GOAL_CENTER.y) <= GOAL_WIDTH / 2 && (fb.z ?? 0) <= 2.44) {
        goal = true;
        shotEnd = q;
        break;
      }
    }
    const heading = rel2.x > release.x;
    const isShot =
      relSpeed >= shotSpeed && heading && distance(release, GOAL_CENTER) < 35 && maxX >= PITCH.length - 4;
    if (isShot && shotEnd) {
      push({
        teamId: seg.teamId,
        playerId: seg.playerId,
        period: seg.period,
        t: round(f1.t, 2),
        type: 'shot',
        start: release,
        end: shotEnd,
        success: goal,
        confidence: 0.65,
      });
      continue;
    }
    if (!sameWindow || !next) continue;
    const endRaw = ballAt(next.i0);
    const tNext = (frames[next.i0] as (typeof frames)[number]).t;
    if (next.teamId === seg.teamId) {
      if (next.playerId === seg.playerId) continue;
      const end = norm(seg.teamId, seg.period, endRaw);
      const wide = release.y < 13.84 || release.y > PITCH.width - 13.84;
      const inBox = end.x >= PITCH.length - 16.5 && Math.abs(end.y - GOAL_CENTER.y) <= 20.16;
      push({
        teamId: seg.teamId,
        playerId: seg.playerId,
        period: seg.period,
        t: round(f1.t, 2),
        type: wide && release.x > 70 && inBox ? 'cross' : 'pass',
        start: release,
        end,
        success: true,
        recipientId: next.playerId,
        confidence: 0.75,
      });
    } else {
      const flight = distance(b1, endRaw);
      const atNext = norm(next.teamId, seg.period, endRaw);
      if (flight >= 3) {
        push({
          teamId: seg.teamId,
          playerId: seg.playerId,
          period: seg.period,
          t: round(f1.t, 2),
          type: 'pass',
          start: release,
          end: norm(seg.teamId, seg.period, endRaw),
          success: false,
          confidence: 0.65,
        });
        push({
          teamId: next.teamId,
          playerId: next.playerId,
          period: seg.period,
          t: round(tNext, 2),
          type: tNext - f1.t <= 2.5 ? 'interception' : 'recovery',
          start: atNext,
          end: atNext,
          success: true,
          confidence: 0.65,
        });
      } else {
        push({
          teamId: next.teamId,
          playerId: next.playerId,
          period: seg.period,
          t: round(tNext, 2),
          type: 'tackle',
          start: atNext,
          end: atNext,
          success: true,
          confidence: 0.55,
        });
      }
    }
  }

  out.sort((a, b) => a.ev.period - b.ev.period || a.ev.t - b.ev.t || a.order - b.order);
  return out.map(({ ev }, idx) => ({ id: `${meta.matchId}-ev-${idx}`, ...ev }));
}
