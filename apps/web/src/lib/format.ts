import { METRIC_META, PlayerMetricKey, type ProcessingJob } from '@soccalytics/contracts';

export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString('en-GB'),
  compact: (n: number) =>
    new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: n >= 1000 ? 1 : 0 }).format(n),
  dec: (n: number, d = 1) => n.toFixed(d),
  xg: (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2)),
  pct: (n: number, d = 0) => `${n.toFixed(d)}%`,
  rating: (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(1)),
  date: (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  dateTime: (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  shortDate: (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  ordinal: (n: number) => {
    const r = Math.round(n);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = r % 100;
    return r + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  },
};

export function metricLabel(key: string): string {
  const parsed = PlayerMetricKey.safeParse(key);
  if (parsed.success) return METRIC_META[parsed.data].label;
  // team-level or unknown keys: snake/camel → words
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function formatMetric(key: string, value: number): string {
  const parsed = PlayerMetricKey.safeParse(key);
  const unit = parsed.success ? METRIC_META[parsed.data].unit : undefined;
  if (unit === '%') return `${asPct(value).toFixed(0)}%`; // API may send 0–1 or 0–100
  const v = Number.isInteger(value) ? fmt.int(value) : Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1);
  return unit && unit !== 'min' ? `${v} ${unit}` : v;
}

/** Normalise a 0–1 or 0–100 percentage to 0–100. */
export function asPct(n: number): number {
  return n <= 1 ? n * 100 : n;
}

export function jobProgress(job: ProcessingJob): number {
  if (!job.stages.length) return 0;
  return job.stages.reduce((s, st) => s + (st.status === 'completed' ? 1 : st.progress), 0) / job.stages.length;
}
