import type { MatchStatus, MatchSummary } from '@soccalytics/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { fmt } from '../lib/format';
import { Icon } from './icons';
import { Badge, TeamCrest } from './ui';

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  if (status === 'analysed')
    return (
      <Badge tone="good">
        <Icon.check size={12} /> Analysed
      </Badge>
    );
  if (status === 'processing')
    return (
      <Badge tone="accent">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Processing
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge tone="critical">
        <Icon.x size={12} /> Failed
      </Badge>
    );
  return <Badge>Scheduled</Badge>;
}

export function SourceBadge({ source }: { source: MatchSummary['source'] }) {
  const label = source === 'video_upload' ? 'Video' : source === 'simulation' ? 'Simulated' : 'Wearables';
  return <Badge>{label}</Badge>;
}

/** Compact clickable match row: teams, score, xG. */
export function MatchRow({ m, compact }: { m: MatchSummary; compact?: boolean }) {
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  return (
    <Link
      href={`/matches/${m.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span className="truncate text-sm font-medium">{compact ? m.homeTeam.shortName : m.homeTeam.name}</span>
        <TeamCrest team={m.homeTeam} size={26} />
      </div>
      <div className="flex min-w-24 flex-col items-center">
        <span className="tabular text-lg font-semibold tracking-tight">
          {hasScore ? `${m.homeScore} – ${m.awayScore}` : 'vs'}
        </span>
        <span className="tabular text-[11px] text-muted">
          {m.homeXg !== null && m.awayXg !== null ? `xG ${fmt.xg(m.homeXg)} – ${fmt.xg(m.awayXg)}` : fmt.shortDate(m.kickoffAt)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <TeamCrest team={m.awayTeam} size={26} />
        <span className="truncate text-sm font-medium">{compact ? m.awayTeam.shortName : m.awayTeam.name}</span>
      </div>
    </Link>
  );
}

/** Wide match row for the matches table/list. */
export function MatchListItem({ m }: { m: MatchSummary }) {
  return (
    <li className={clsx('card overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className="font-medium text-text-2">{m.competition}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={m.kickoffAt}>{fmt.dateTime(m.kickoffAt)}</time>
          {m.venue && (
            <>
              <span aria-hidden="true">·</span>
              <span>{m.venue}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <SourceBadge source={m.source} />
          <MatchStatusBadge status={m.status} />
        </span>
      </div>
      <MatchRow m={m} />
    </li>
  );
}
