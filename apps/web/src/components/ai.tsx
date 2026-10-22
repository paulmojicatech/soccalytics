'use client';

import type { AiArtifactMeta, GroundedClaim } from '@soccalytics/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { fmt, formatMetric, metricLabel } from '../lib/format';
import { Icon } from './icons';

export interface SubjectInfo {
  label: string;
  href?: string;
}
export type SubjectResolver = (id: string) => SubjectInfo | undefined;

export function EvidenceChips({ evidence, resolve }: { evidence: GroundedClaim['evidence']; resolve?: SubjectResolver }) {
  if (!evidence.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Evidence">
      {evidence.map((e, i) => {
        const subject = resolve?.(e.subject);
        const body = (
          <>
            <span className="text-muted">{metricLabel(e.metric)}</span>
            <span className="tabular font-semibold text-text">{formatMetric(e.metric, e.value)}</span>
            {subject && <span className="max-w-32 truncate text-muted">· {subject.label}</span>}
          </>
        );
        const cls =
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px]';
        return (
          <li key={i}>
            {subject?.href ? (
              <Link href={subject.href} className={`${cls} hover:border-border-strong`}>
                {body}
              </Link>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ClaimItem({ claim, resolve }: { claim: GroundedClaim; resolve?: SubjectResolver }) {
  return (
    <li className="py-2.5">
      <p className="text-sm leading-relaxed">{claim.text}</p>
      <EvidenceChips evidence={claim.evidence} resolve={resolve} />
    </li>
  );
}

export function ClaimList({
  claims,
  resolve,
  empty = 'Nothing to report.',
}: {
  claims: GroundedClaim[];
  resolve?: SubjectResolver;
  empty?: string;
}) {
  if (!claims.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {claims.map((c, i) => (
        <ClaimItem key={i} claim={c} resolve={resolve} />
      ))}
    </ul>
  );
}

export function GroundingBadge({ grounding }: { grounding: AiArtifactMeta['grounding'] }) {
  const [open, setOpen] = useState(false);
  const clean = grounding.violations.length === 0 && grounding.verified >= grounding.claims;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => !clean && setOpen((o) => !o)}
        aria-expanded={clean ? undefined : open}
        className={
          clean
            ? 'inline-flex cursor-default items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good-text'
            : 'inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-text'
        }
      >
        {clean ? <Icon.check size={14} /> : <Icon.alert size={14} className="text-warning" />}
        {grounding.verified}/{grounding.claims} claims verified
        {!clean && ` · ${grounding.violations.length} flagged`}
      </button>
      {open && !clean && (
        <ul className="max-w-xl rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-2">
          {grounding.violations.map((v, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <Icon.alert size={12} className="mt-0.5 shrink-0 text-warning" />
              <span className="font-mono">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProvenanceFooter({ meta }: { meta: AiArtifactMeta }) {
  const items: [string, string][] = [
    ['Model', meta.model],
    ['Prompt', meta.promptVersion],
    ['Tokens', `${fmt.int(meta.inputTokens)} in · ${fmt.int(meta.outputTokens)} out`],
    ['Cache reads', fmt.int(meta.cacheReadTokens)],
    ['Latency', meta.latencyMs >= 1000 ? `${(meta.latencyMs / 1000).toFixed(1)} s` : `${Math.round(meta.latencyMs)} ms`],
    ['Generated', fmt.dateTime(meta.generatedAt)],
  ];
  return (
    <footer className="mt-6 border-t border-border pt-3">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
        {items.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt>{k}</dt>
            <dd className="tabular font-mono text-text-2">{v}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}
