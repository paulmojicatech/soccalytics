'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

export interface TooltipRow {
  color?: string;
  label: ReactNode;
  value: ReactNode;
}

export interface TooltipContent {
  title: ReactNode;
  rows: TooltipRow[];
}

/** Tooltip card: values lead (strong), labels follow; line keys, not boxes. */
export function TooltipCard({ title, rows }: TooltipContent) {
  return (
    <div className="min-w-36 rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-text-2">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.color && <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: r.color }} />}
            <span className="tabular font-semibold text-text">{r.value}</span>
            <span className="text-muted">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Positions an HTML tooltip over an SVG mark. Attach `containerRef` to a
 * relatively-positioned wrapper and call `show(event.currentTarget, content)`
 * from pointer-enter / focus handlers of each mark.
 */
export function useMarkTooltip() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ x: number; y: number; content: TooltipContent } | null>(null);

  const show = useCallback((el: Element, content: TooltipContent) => {
    const box = containerRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setState({ x: r.left + r.width / 2 - box.left, y: r.top - box.top, content });
  }, []);
  const hide = useCallback(() => setState(null), []);

  const tooltip = state ? (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: Math.max(70, Math.min(state.x, (containerRef.current?.clientWidth ?? 0) - 70)), top: state.y }}
      role="status"
    >
      <TooltipCard {...state.content} />
    </div>
  ) : null;

  return { containerRef, show, hide, tooltip };
}
