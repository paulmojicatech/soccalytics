'use client';

import clsx from 'clsx';
import Link from 'next/link';
import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { isOfflineError } from '../lib/api';
import { Icon } from './icons';

// ── Layout ──────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  as: As = 'section',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
}) {
  const id = useId();
  return (
    <As className={clsx('card min-w-0', className)} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && (
              <h2 id={id} className="text-sm font-semibold">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx('p-5', title && 'pt-3', bodyClassName)}>{children}</div>
    </As>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

const buttonClasses = (variant: Variant, size: Size) =>
  clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
    size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
    variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-strong',
    variant === 'secondary' && 'border border-border-strong bg-surface-2 text-text hover:bg-surface-3',
    variant === 'ghost' && 'text-text-2 hover:bg-surface-2 hover:text-text',
  );

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(buttonClasses(variant, size), className)}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={clsx(buttonClasses(variant, size), className)} {...rest} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'accent' | 'good' | 'warning' | 'critical' | 'home' | 'away';

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-3 text-text-2',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'good' && 'bg-good-soft text-good-text',
        tone === 'warning' && 'bg-warning-soft text-text',
        tone === 'critical' && 'bg-critical-soft text-critical-text',
        tone === 'home' && 'bg-[var(--home-soft)] text-text',
        tone === 'away' && 'bg-[var(--away-soft)] text-text',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Tabs (WAI-ARIA tabs pattern with arrow-key navigation) ───────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  size = 'md',
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx(
        'flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1',
        size === 'sm' ? 'text-xs' : 'text-sm',
      )}
    >
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={clsx(
              'shrink-0 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5',
              selected ? 'bg-surface text-text shadow-sm' : 'text-text-2 hover:text-text',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="focus-visible:outline-none">
      {children}
    </div>
  );
}

// ── Form controls ───────────────────────────────────────────────────────────

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-border-strong bg-surface-2 px-3 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent';

// ── Progress ────────────────────────────────────────────────────────────────

export function ProgressBar({ value, label, tone = 'accent' }: { value: number; label: string; tone?: 'accent' | 'critical' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft"
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', tone === 'accent' ? 'bg-accent' : 'bg-critical')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── States ──────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={clsx('h-10', i % 2 ? 'w-4/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-surface-3 text-muted">{icon ?? <Icon.ball />}</div>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const offline = isOfflineError(error);
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'px-3 py-6' : 'px-4 py-12',
      )}
    >
      <div
        className={clsx(
          'mb-1 grid h-10 w-10 place-items-center rounded-full',
          offline ? 'bg-warning-soft text-warning' : 'bg-critical-soft text-critical-text',
        )}
      >
        {offline ? <Icon.plug /> : <Icon.alert />}
      </div>
      <p className="text-sm font-medium">{offline ? 'API offline' : 'Could not load data'}</p>
      <p className="max-w-md text-sm text-muted">
        {offline ? (
          <>
            The analytics API isn&apos;t reachable. Start it with{' '}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text">pnpm nx serve api</code>
          </>
        ) : (
          message
        )}
      </p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          <Icon.refresh size={14} /> Retry
        </Button>
      )}
    </div>
  );
}

/** Render loading / error / data for a react-query result. */
export function QueryState<T>({
  query,
  loading,
  children,
  compact,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  loading?: ReactNode;
  children: (data: T) => ReactNode;
  compact?: boolean;
}) {
  if (query.isPending) return <>{loading ?? <LoadingBlock />}</>;
  if (query.error || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact={compact} />;
  return <>{children(query.data)}</>;
}

// ── Stat tile ───────────────────────────────────────────────────────────────

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-text-2">
        <span>{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

// ── Team crest ──────────────────────────────────────────────────────────────

function inkFor(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return '#fff';
  const [r, g, b] = m.slice(1, 4).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#0b0b0b' : '#ffffff';
}

export function TeamCrest({
  team,
  size = 28,
}: {
  team: { shortName: string; primaryColor: string; secondaryColor: string };
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-lg font-bold tracking-tighter ring-1 ring-border-strong"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, size * 0.3),
        background: team.primaryColor,
        boxShadow: `inset 0 -${Math.max(2, Math.round(size / 10))}px 0 ${team.secondaryColor}`,
        color: inkFor(team.primaryColor),
      }}
    >
      {team.shortName.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** Small legend key: a coloured mark beside ink-coloured text. */
export function SeriesKey({ color, label, shape = 'rect' }: { color: string; label: ReactNode; shape?: 'rect' | 'line' | 'dot' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
      <span
        aria-hidden="true"
        className={clsx(shape === 'rect' && 'h-2.5 w-2.5 rounded-sm', shape === 'line' && 'h-0.5 w-3.5 rounded', shape === 'dot' && 'h-2.5 w-2.5 rounded-full')}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
