import { MatchEvent, type MatchEventInput } from '@soccalytics/contracts';
import { isProgressive } from './progressive.js';
import { priorXtGrid, xtAt, type XtGrid } from './xt.js';
import { xgForShot } from './xg.js';
import { round } from './math.js';

const XT_TYPES: ReadonlySet<MatchEvent['type']> = new Set(['pass', 'cross', 'carry', 'dribble']);

let cachedPrior: XtGrid | null = null;
const defaultGrid = (): XtGrid => (cachedPrior ??= priorXtGrid());

/**
 * Validate raw events and attach model outputs:
 *   - `xg` for shots,
 *   - `xt` = xT(end) − xT(start) for successful pass/cross/carry/dribble
 *     (null otherwise, following Singh's convention of crediting only
 *     completed moves),
 *   - `progressive` per the Wyscout definition.
 */
export function enrichEvents(events: readonly MatchEventInput[], grid?: XtGrid): MatchEvent[] {
  const g = grid ?? defaultGrid();
  return events.map((raw) => {
    const e = MatchEvent.parse(raw);
    const xg = e.type === 'shot' ? round(xgForShot(e), 4) : null;
    const xt = XT_TYPES.has(e.type) && e.success ? round(xtAt(g, e.end) - xtAt(g, e.start), 5) : null;
    return { ...e, xg, xt, progressive: isProgressive(e) };
  });
}
