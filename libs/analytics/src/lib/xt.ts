import { PITCH, type MatchEvent, type Point } from '@soccalytics/contracts';
import { distanceToGoal } from './geometry.js';
import { clamp } from './math.js';
import { xgForShot } from './xg.js';

/**
 * Expected-threat grid: the probability that possession of the ball in a zone
 * leads to a goal within the next few actions (Karun Singh, 2018).
 *
 * `values[iy][ix]` — row `iy` spans y ∈ [iy·h, (iy+1)·h), column `ix` spans
 * x ∈ [ix·w, (ix+1)·w), in the normalised frame (attacking towards x = 105).
 */
export interface XtGrid {
  cols: number;
  rows: number;
  values: number[][];
}

export const XT_COLS = 16;
export const XT_ROWS = 12;

const MOVE_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['pass', 'cross', 'carry', 'dribble']);

export function cellOf(p: Point, cols = XT_COLS, rows = XT_ROWS): { ix: number; iy: number } {
  const ix = clamp(Math.floor((p.x / PITCH.length) * cols), 0, cols - 1);
  const iy = clamp(Math.floor((p.y / PITCH.width) * rows), 0, rows - 1);
  return { ix, iy };
}

const cellCentre = (ix: number, iy: number, cols: number, rows: number): Point => ({
  x: ((ix + 0.5) * PITCH.length) / cols,
  y: ((iy + 0.5) * PITCH.width) / rows,
});

/**
 * Smooth prior xT surface used before (or alongside) data-driven fitting.
 *
 * Built from first principles: a cell's threat is dominated by the chance of
 * scoring directly from it (60 % of its open-play footed xG — not every
 * possession there ends in a shot), plus a slowly decaying "proximity" term
 * (0.06·e^(−d/20)) for the value of being able to move the ball closer, plus
 * a 0.005 floor. The result has the familiar xT shape: ≈0.006 near the own
 * goal, ≈0.012 at the halfway line, ≈0.1 on the edge of the box and ≈0.35 in
 * the six-yard box.
 */
export function priorXtGrid(cols = XT_COLS, rows = XT_ROWS): XtGrid {
  const values: number[][] = [];
  for (let iy = 0; iy < rows; iy++) {
    const row: number[] = [];
    for (let ix = 0; ix < cols; ix++) {
      const c = cellCentre(ix, iy, cols, rows);
      const v = 0.6 * xgForShot({ start: c }) + 0.06 * Math.exp(-distanceToGoal(c) / 20) + 0.005;
      row.push(v);
    }
    values.push(row);
  }
  return { cols, rows, values };
}

export interface FitXtOptions {
  cols?: number;
  rows?: number;
  maxIterations?: number;
  tolerance?: number;
  /**
   * Pseudo-count controlling the blend with the prior: a cell observed with
   * `n` actions keeps `n / (n + priorStrength)` of its fitted value.
   */
  priorStrength?: number;
  prior?: XtGrid;
}

/**
 * Fit an xT grid from event data with Karun Singh's value iteration:
 *
 *   xT(z) = s(z)·g(z) + m(z)·Σ_z' T(z→z')·xT(z')
 *
 * where s/m are the shoot/move probabilities in zone z, g the goal-given-shot
 * probability and T the transition matrix of *successful* moves (failed moves
 * contribute zero value). Iterated from zero until the largest change falls
 * below `tolerance`. Sparse cells are shrunk towards the prior.
 */
export function fitXtGrid(events: readonly MatchEvent[], opts: FitXtOptions = {}): XtGrid {
  const cols = opts.cols ?? XT_COLS;
  const rows = opts.rows ?? XT_ROWS;
  const n = cols * rows;
  const prior = opts.prior ?? priorXtGrid(cols, rows);
  const k = opts.priorStrength ?? 20;
  const tol = opts.tolerance ?? 1e-6;
  const maxIter = opts.maxIterations ?? 200;

  const shots = new Float64Array(n);
  const goals = new Float64Array(n);
  const moves = new Float64Array(n);
  const trans = new Map<number, Map<number, number>>();

  for (const e of events) {
    const a = cellOf(e.start, cols, rows);
    const from = a.iy * cols + a.ix;
    if (e.type === 'shot') {
      if (e.playPattern === 'penalty') continue;
      shots[from]++;
      if (e.success) goals[from]++;
    } else if (MOVE_TYPES.has(e.type)) {
      moves[from]++;
      if (e.success) {
        const b = cellOf(e.end, cols, rows);
        const to = b.iy * cols + b.ix;
        let row = trans.get(from);
        if (!row) trans.set(from, (row = new Map()));
        row.set(to, (row.get(to) ?? 0) + 1);
      }
    }
  }

  const s = new Float64Array(n);
  const m = new Float64Array(n);
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const total = (shots[i] as number) + (moves[i] as number);
    if (total > 0) {
      s[i] = (shots[i] as number) / total;
      m[i] = (moves[i] as number) / total;
    }
    if ((shots[i] as number) > 0) g[i] = (goals[i] as number) / (shots[i] as number);
  }

  let xt: Float64Array = new Float64Array(n);
  for (let it = 0; it < maxIter; it++) {
    const next = new Float64Array(n);
    let delta = 0;
    for (let i = 0; i < n; i++) {
      let moveValue = 0;
      const row = trans.get(i);
      const mv = moves[i] as number;
      if (row && mv > 0) for (const [to, c] of row) moveValue += (c / mv) * (xt[to] as number);
      const v = (s[i] as number) * (g[i] as number) + (m[i] as number) * moveValue;
      next[i] = v;
      delta = Math.max(delta, Math.abs(v - (xt[i] as number)));
    }
    xt = next;
    if (delta < tol) break;
  }

  const values: number[][] = [];
  for (let iy = 0; iy < rows; iy++) {
    const row: number[] = [];
    for (let ix = 0; ix < cols; ix++) {
      const i = iy * cols + ix;
      const obs = (shots[i] as number) + (moves[i] as number);
      const w = obs + k > 0 ? obs / (obs + k) : 1;
      const p = prior.values[iy]?.[ix] ?? 0;
      row.push(w * (xt[i] as number) + (1 - w) * p);
    }
    values.push(row);
  }
  return { cols, rows, values };
}

/** Look up the xT value at a pitch location (normalised frame). */
export function xtAt(grid: XtGrid, p: Point): number {
  const { ix, iy } = cellOf(p, grid.cols, grid.rows);
  return grid.values[iy]?.[ix] ?? 0;
}
