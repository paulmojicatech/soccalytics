import type { TrackingDocument } from '@soccalytics/contracts';
import { round } from './math.js';

export interface PhysicalMetrics {
  distance_km: number;
  hsr_distance_m: number;
  sprint_count: number;
  top_speed_kmh: number;
}

/** Speed thresholds (m/s): 19.8 km/h high-speed running, 25.2 km/h sprinting. */
export const HSR_THRESHOLD_MS = 19.8 / 3.6;
export const SPRINT_THRESHOLD_MS = 25.2 / 3.6;
/** A sprint must be sustained this long to count. */
export const SPRINT_MIN_DURATION_S = 1;
/** Displacements faster than this are tracking identity swaps / teleports. */
export const MAX_PLAUSIBLE_SPEED_MS = 12;
/** Gaps longer than this split a track (player off-screen, substitution…). */
const MAX_GAP_S = 1.0;

interface Sample {
  t: number;
  x: number;
  y: number;
}

const emptyPhysical = (): PhysicalMetrics => ({ distance_km: 0, hsr_distance_m: 0, sprint_count: 0, top_speed_kmh: 0 });

/**
 * Per-player physical load from positional tracking.
 *
 * Each player's track is split into continuous segments (break on period
 * change, gaps > 1 s or implausible jumps > 12 m/s), positions are smoothed
 * with a centred ≈1 s moving average to suppress detection jitter, and speed
 * is differentiated from the smoothed path. HSR distance accumulates while
 * speed > 19.8 km/h; a sprint is a run above 25.2 km/h lasting ≥ 1 s.
 */
export function computePhysical(doc: TrackingDocument): Map<string, PhysicalMetrics> {
  const fps = doc.meta.fps > 0 ? doc.meta.fps : 10;
  const tracks = new Map<string, { period: number; s: Sample }[]>();
  for (const f of doc.frames) {
    for (const p of f.players) {
      let tr = tracks.get(p.playerId);
      if (!tr) tracks.set(p.playerId, (tr = []));
      tr.push({ period: f.period, s: { t: f.t, x: p.x, y: p.y } });
    }
  }

  const half = Math.max(1, Math.round(fps * 0.4));
  const out = new Map<string, PhysicalMetrics>();

  for (const [playerId, tr] of tracks) {
    const acc = emptyPhysical();
    let topSpeed = 0;
    // segment split
    const segments: Sample[][] = [];
    let cur: Sample[] = [];
    for (let i = 0; i < tr.length; i++) {
      const a = tr[i] as { period: number; s: Sample };
      const prev = i > 0 ? (tr[i - 1] as { period: number; s: Sample }) : null;
      let split = !prev;
      if (prev) {
        const dt = a.s.t - prev.s.t;
        if (a.period !== prev.period || dt <= 0 || dt > MAX_GAP_S) split = true;
        else if (Math.hypot(a.s.x - prev.s.x, a.s.y - prev.s.y) / dt > MAX_PLAUSIBLE_SPEED_MS) split = true;
      }
      if (split && cur.length) {
        segments.push(cur);
        cur = [];
      }
      cur.push(a.s);
    }
    if (cur.length) segments.push(cur);

    for (const seg of segments) {
      if (seg.length < 2) continue;
      // centred moving average of positions
      const sm: Sample[] = seg.map((s, i) => {
        const lo = Math.max(0, i - half);
        const hi = Math.min(seg.length - 1, i + half);
        let sx = 0;
        let sy = 0;
        for (let j = lo; j <= hi; j++) {
          sx += (seg[j] as Sample).x;
          sy += (seg[j] as Sample).y;
        }
        const n = hi - lo + 1;
        return { t: s.t, x: sx / n, y: sy / n };
      });
      let sprintTime = 0;
      let sprintCounted = false;
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1] as Sample;
        const b = sm[i] as Sample;
        const dt = b.t - a.t;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const v = d / dt;
        acc.distance_km += d / 1000;
        if (v > HSR_THRESHOLD_MS) acc.hsr_distance_m += d;
        if (v > topSpeed) topSpeed = v;
        if (v > SPRINT_THRESHOLD_MS) {
          sprintTime += dt;
          if (!sprintCounted && sprintTime >= SPRINT_MIN_DURATION_S - 1e-9) {
            acc.sprint_count++;
            sprintCounted = true;
          }
        } else {
          sprintTime = 0;
          sprintCounted = false;
        }
      }
    }
    out.set(playerId, {
      distance_km: round(acc.distance_km, 3),
      hsr_distance_m: round(acc.hsr_distance_m, 1),
      sprint_count: acc.sprint_count,
      top_speed_kmh: round(topSpeed * 3.6, 1),
    });
  }
  return out;
}
