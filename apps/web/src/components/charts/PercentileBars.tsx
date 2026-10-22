import { METRIC_META, type MetricGroup, type PlayerBenchmark } from '@soccalytics/contracts';
import clsx from 'clsx';
import { fmt, formatMetric } from '../../lib/format';
import { Icon } from '../icons';

const GROUP_LABEL: Record<MetricGroup, string> = {
  volume: 'Volume',
  physical: 'Physical',
  possession: 'In possession',
  shooting: 'Shooting & chance creation',
  defending: 'Defending & pressing',
};
const GROUP_ORDER: MetricGroup[] = ['possession', 'shooting', 'defending', 'physical'];

/**
 * Percentile rank per metric vs the chosen cohort (0–100, cohort median at the
 * 50 tick). Single series → one hue; strengths/weaknesses are flagged with an
 * icon + label, never by colour alone.
 */
export function PercentileBars({ benchmark }: { benchmark: PlayerBenchmark }) {
  const strengths = new Set(benchmark.strengths);
  const weaknesses = new Set(benchmark.weaknesses);
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    metrics: benchmark.metrics.filter((m) => METRIC_META[m.metric]?.group === g),
  })).filter((g) => g.metrics.length > 0);

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
      {grouped.map(({ group, metrics }) => (
        <section key={group} aria-label={GROUP_LABEL[group]}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{GROUP_LABEL[group]}</h3>
          <ul className="flex flex-col gap-2.5">
            {metrics.map((m) => {
              const pct = Math.max(0, Math.min(100, m.percentile));
              const isStrength = strengths.has(m.metric);
              const isWeakness = weaknesses.has(m.metric);
              return (
                <li
                  key={m.metric}
                  className={clsx(
                    'rounded-lg px-2 py-1.5',
                    isStrength && 'bg-good-soft',
                    isWeakness && 'bg-critical-soft',
                  )}
                  title={`${METRIC_META[m.metric].label}: ${formatMetric(m.metric, m.value)} per 90 · cohort median ${formatMetric(m.metric, m.cohortMedian)} · ${fmt.ordinal(pct)} percentile`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      {isStrength && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-good-text">
                          <Icon.arrowUp size={12} />
                          <span className="sr-only">Strength:</span>
                        </span>
                      )}
                      {isWeakness && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-critical-text">
                          <Icon.arrowDown size={12} />
                          <span className="sr-only">Weakness:</span>
                        </span>
                      )}
                      <span className="truncate">{METRIC_META[m.metric].label}</span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-text-2">
                      {formatMetric(m.metric, m.value)}
                      <span className="text-muted"> · </span>
                      <b className="text-text">{Math.round(pct)}</b>
                      <span className="text-muted"> pct</span>
                    </span>
                  </div>
                  <div className="relative h-2 rounded-r bg-surface-3" aria-hidden="true">
                    <div className="h-full rounded-r" style={{ width: `${pct}%`, background: 'var(--series-1)' }} />
                    <div className="absolute inset-y-[-3px] left-1/2 w-px bg-text-2 opacity-60" />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
