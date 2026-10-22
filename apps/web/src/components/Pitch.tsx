import { PITCH } from '@soccalytics/contracts';
import type { ReactNode, SVGProps } from 'react';

const L = PITCH.length; // 105
const W = PITCH.width; // 68
const PAD = 3;

/** Contract y has origin bottom-left; SVG y grows downward. */
export const toSvgY = (y: number) => W - y;

const PEN_DEPTH = 16.5;
const PEN_WIDTH = 40.32;
const SIX_DEPTH = 5.5;
const SIX_WIDTH = 18.32;
const SPOT = 11;
const CIRCLE_R = 9.15;
const GOAL_W = 7.32;
const GOAL_D = 2;

/** Half-height of the penalty arc where it meets the penalty-area line. */
const ARC_DY = Math.sqrt(CIRCLE_R ** 2 - (PEN_DEPTH - SPOT) ** 2);

/**
 * Pitch drawn in metres on a 105×68 coordinate system (plus a small margin for
 * the goals). Children are rendered in the same coordinate space — use
 * `toSvgY` to convert contract y values.
 */
export function Pitch({
  children,
  title,
  className,
  stripes = true,
  ...rest
}: { children?: ReactNode; title: string; stripes?: boolean } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const cy = W / 2;
  const line = { fill: 'none', stroke: 'var(--pitch-line)', strokeWidth: 0.3 } as const;
  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${L + PAD * 2} ${W + PAD * 2}`}
      role="img"
      aria-label={title}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      {...rest}
    >
      <title>{title}</title>
      <rect x={-PAD} y={-PAD} width={L + PAD * 2} height={W + PAD * 2} fill="var(--pitch)" rx={2} />
      {stripes &&
        Array.from({ length: 12 }, (_, i) =>
          i % 2 ? <rect key={i} x={(L / 12) * i} y={0} width={L / 12} height={W} fill="var(--pitch-stripe)" /> : null,
        )}
      <g {...line}>
        <rect x={0} y={0} width={L} height={W} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
        <circle cx={L / 2} cy={cy} r={CIRCLE_R} />
        {/* Penalty areas */}
        <rect x={0} y={cy - PEN_WIDTH / 2} width={PEN_DEPTH} height={PEN_WIDTH} />
        <rect x={L - PEN_DEPTH} y={cy - PEN_WIDTH / 2} width={PEN_DEPTH} height={PEN_WIDTH} />
        {/* Six-yard boxes */}
        <rect x={0} y={cy - SIX_WIDTH / 2} width={SIX_DEPTH} height={SIX_WIDTH} />
        <rect x={L - SIX_DEPTH} y={cy - SIX_WIDTH / 2} width={SIX_DEPTH} height={SIX_WIDTH} />
        {/* Penalty arcs ("D") */}
        <path d={`M ${PEN_DEPTH} ${cy - ARC_DY} A ${CIRCLE_R} ${CIRCLE_R} 0 0 1 ${PEN_DEPTH} ${cy + ARC_DY}`} />
        <path d={`M ${L - PEN_DEPTH} ${cy - ARC_DY} A ${CIRCLE_R} ${CIRCLE_R} 0 0 0 ${L - PEN_DEPTH} ${cy + ARC_DY}`} />
        {/* Corner arcs */}
        <path d={`M 0 1 A 1 1 0 0 0 1 0`} />
        <path d={`M ${L - 1} 0 A 1 1 0 0 0 ${L} 1`} />
        <path d={`M 0 ${W - 1} A 1 1 0 0 1 1 ${W}`} />
        <path d={`M ${L - 1} ${W} A 1 1 0 0 1 ${L} ${W - 1}`} />
        {/* Goals */}
        <rect x={-GOAL_D} y={cy - GOAL_W / 2} width={GOAL_D} height={GOAL_W} />
        <rect x={L} y={cy - GOAL_W / 2} width={GOAL_D} height={GOAL_W} />
      </g>
      <g fill="var(--pitch-line)">
        <circle cx={L / 2} cy={cy} r={0.45} />
        <circle cx={SPOT} cy={cy} r={0.4} />
        <circle cx={L - SPOT} cy={cy} r={0.4} />
      </g>
      {children}
    </svg>
  );
}
