'use client';

import type { PlayerTrend } from '@soccalytics/contracts';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '../../lib/format';
import { SeriesKey } from '../ui';
import { TooltipCard } from './ChartTooltip';

interface Row {
  i: number;
  date?: string;
  rating?: number;
  proj?: number;
  band?: [number, number];
}

/**
 * Match ratings (solid line) plus an N-match projection: dashed centre line
 * and an 80% prediction band as a 10% wash. Single series, single axis.
 */
export function RatingTrend({ trend }: { trend: PlayerTrend }) {
  const pts = [...trend.points].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  if (pts.length === 0) return <p className="py-10 text-center text-sm text-muted">No rated matches yet.</p>;

  const last = pts.length - 1;
  const lastRating = pts[last].rating;
  const { horizonMatches: h, rating: projRating, low, high } = trend.projection;
  const rows: Row[] = pts.map((p, i) => ({ i, date: p.kickoffAt, rating: p.rating }));
  rows[last] = { ...rows[last], proj: lastRating, band: [lastRating, lastRating] };
  if (h > 0) rows.push({ i: last + h, proj: projRating, band: [low, high] });

  const values = [...pts.map((p) => p.rating), low, high];
  const yMin = Math.max(0, Math.floor(Math.min(...values) - 0.5));
  const yMax = Math.min(10, Math.ceil(Math.max(...values) + 0.5));
  const slope = trend.ratingSlope;

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <SeriesKey color="var(--series-1)" shape="line" label="Match rating" />
        <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
          <span aria-hidden="true" className="h-2.5 w-4 rounded-sm" style={{ background: 'var(--home-soft)' }} />
          Projection, 80% interval ({h} matches)
        </span>
        <span className="ml-auto text-xs text-text-2">
          Trend{' '}
          <b className="tabular text-text">
            {slope >= 0 ? '+' : ''}
            {slope.toFixed(2)}
          </b>{' '}
          per match
        </span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="i"
              type="number"
              domain={[0, rows[rows.length - 1].i]}
              ticks={rows.map((r) => r.i)}
              interval="preserveStartEnd"
              tickFormatter={(i: number) => {
                const r = rows.find((x) => x.i === i);
                return r?.date ? fmt.shortDate(r.date) : `+${i - last}`;
              }}
              stroke="var(--axis)"
              tickLine={false}
              minTickGap={16}
            />
            <YAxis domain={[yMin, yMax]} stroke="var(--axis)" tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as Row | undefined;
                if (!active || !row) return null;
                if (row.rating !== undefined)
                  return (
                    <TooltipCard
                      title={row.date ? fmt.date(row.date) : 'Match'}
                      rows={[{ color: 'var(--series-1)', label: 'rating', value: row.rating.toFixed(1) }]}
                    />
                  );
                return (
                  <TooltipCard
                    title={`Projected, ${h} matches ahead`}
                    rows={[
                      { color: 'var(--series-1)', label: 'rating', value: (row.proj ?? 0).toFixed(1) },
                      { label: '80% range', value: row.band ? `${row.band[0].toFixed(1)}–${row.band[1].toFixed(1)}` : '–' },
                    ]}
                  />
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill="var(--series-1)" fillOpacity={0.12} isAnimationActive={false} connectNulls />
            <Line
              dataKey="proj"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="rating"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
              activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Ratings over {pts.length} matches, latest {lastRating.toFixed(1)}. Projected {projRating.toFixed(1)} (range{' '}
        {low.toFixed(1)} to {high.toFixed(1)}) in {h} matches.
      </figcaption>
    </figure>
  );
}
