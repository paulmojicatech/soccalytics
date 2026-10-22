'use client';

import type { PassingNetwork as PassingNetworkData } from '@soccalytics/contracts';
import { useId, useMemo, useState } from 'react';
import { Pitch, toSvgY } from '../Pitch';
import { Tabs } from '../ui';
import { useMarkTooltip } from './ChartTooltip';

interface PlayerInfo {
  name: string;
  shirtNumber: number | null;
}

/**
 * Passing network: nodes at each player's average on-ball position (team
 * attacks →), sized by touches and labelled with shirt numbers; edge width by
 * completed passes between the pair (both directions combined).
 */
export function PassingNetwork({
  home,
  away,
  homeName,
  awayName,
  player,
}: {
  home: PassingNetworkData | undefined;
  away: PassingNetworkData | undefined;
  homeName: string;
  awayName: string;
  player: (id: string) => PlayerInfo;
}) {
  const [side, setSide] = useState<'home' | 'away'>('home');
  const [minPasses, setMinPasses] = useState(3);
  const sliderId = useId();
  const { containerRef, show, hide, tooltip } = useMarkTooltip();
  const net = side === 'home' ? home : away;
  const color = side === 'home' ? 'var(--home)' : 'var(--away)';
  const teamName = side === 'home' ? homeName : awayName;

  const { nodes, edges, maxCount, maxTouches, partners } = useMemo(() => {
    if (!net) return { nodes: [], edges: [], maxCount: 1, maxTouches: 1, partners: new Map<string, { id: string; count: number }[]>() };
    // Combine A→B and B→A into one undirected link.
    const pair = new Map<string, { a: string; b: string; count: number }>();
    for (const e of net.edges) {
      const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
      const key = `${a}|${b}`;
      const cur = pair.get(key);
      if (cur) cur.count += e.count;
      else pair.set(key, { a, b, count: e.count });
    }
    const all = [...pair.values()];
    const partnersMap = new Map<string, { id: string; count: number }[]>();
    for (const e of all) {
      partnersMap.set(e.a, [...(partnersMap.get(e.a) ?? []), { id: e.b, count: e.count }]);
      partnersMap.set(e.b, [...(partnersMap.get(e.b) ?? []), { id: e.a, count: e.count }]);
    }
    return {
      nodes: net.nodes,
      edges: all.sort((x, y) => x.count - y.count),
      maxCount: Math.max(1, ...all.map((e) => e.count)),
      maxTouches: Math.max(1, ...net.nodes.map((n) => n.touches)),
      partners: partnersMap,
    };
  }, [net]);

  const byId = new Map(nodes.map((n) => [n.playerId, n]));
  const sliderMax = Math.max(2, Math.min(15, maxCount));
  const threshold = Math.min(minPasses, sliderMax);
  const shown = edges.filter((e) => e.count >= threshold);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          size="sm"
          label="Passing network team"
          value={side}
          onChange={setSide}
          tabs={[
            { id: 'home', label: homeName },
            { id: 'away', label: awayName },
          ]}
        />
        <div className="flex items-center gap-2 text-xs text-text-2">
          <label htmlFor={sliderId}>Min. passes per link</label>
          <input
            id={sliderId}
            type="range"
            min={1}
            max={sliderMax}
            value={threshold}
            onChange={(e) => setMinPasses(Number(e.target.value))}
            className="w-28 accent-[var(--accent)]"
          />
          <span className="tabular w-5 text-text">{threshold}</span>
        </div>
      </div>

      {!net || nodes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No passing network for {teamName}.</p>
      ) : (
        <div ref={containerRef} className="relative mx-auto max-w-5xl">
          <Pitch title={`${teamName} passing network, attacking left to right`} className="w-full">
            <g strokeLinecap="round">
              {shown.map((e) => {
                const a = byId.get(e.a);
                const b = byId.get(e.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={`${e.a}-${e.b}`}
                    x1={a.x}
                    y1={toSvgY(a.y)}
                    x2={b.x}
                    y2={toSvgY(b.y)}
                    stroke={color}
                    strokeOpacity={0.25 + 0.5 * (e.count / maxCount)}
                    strokeWidth={0.25 + 1.6 * (e.count / maxCount)}
                  />
                );
              })}
            </g>
            {nodes.map((n) => {
              const info = player(n.playerId);
              const r = 1.5 + 2.1 * Math.sqrt(n.touches / maxTouches);
              const top = (partners.get(n.playerId) ?? []).sort((x, y) => y.count - x.count).slice(0, 3);
              const content = {
                title: `${info.shirtNumber ?? ''} ${info.name}`.trim(),
                rows: [
                  { color, label: 'touches', value: String(n.touches) },
                  ...top.map((p) => ({ label: `with ${player(p.id).name}`, value: `${p.count} passes` })),
                ],
              };
              return (
                <g
                  key={n.playerId}
                  tabIndex={0}
                  role="img"
                  aria-label={`${info.name}: ${n.touches} touches`}
                  className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[var(--text)]"
                  onPointerEnter={(e) => show(e.currentTarget, content)}
                  onPointerLeave={hide}
                  onFocus={(e) => show(e.currentTarget, content)}
                  onBlur={hide}
                >
                  <circle cx={n.x} cy={toSvgY(n.y)} r={r} fill={color} stroke="var(--pitch)" strokeWidth={0.45} />
                  <text
                    x={n.x}
                    y={toSvgY(n.y)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(1.5, r * 0.8)}
                    fontWeight={700}
                    fill="#fff"
                    style={{ pointerEvents: 'none' }}
                  >
                    {info.shirtNumber ?? '?'}
                  </text>
                </g>
              );
            })}
          </Pitch>
          {tooltip}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Average on-ball positions · {teamName} attacking → · node size = touches · line width = passes between the pair
        ({shown.length} of {edges.length} links shown)
      </p>
    </div>
  );
}
