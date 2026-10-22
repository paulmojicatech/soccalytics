'use client';

import type { MatchReport, Team } from '@soccalytics/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { q } from '../lib/queries';
import { ClaimList, EvidenceChips, GroundingBadge, ProvenanceFooter, type SubjectResolver } from './ai';
import { Icon } from './icons';
import { Button, EmptyState, ErrorState, LoadingBlock, ProgressBar, Tabs } from './ui';

export function useElapsed(active: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    setS(0);
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return s;
}

export function GeneratingState({ what, elapsed }: { what: string; elapsed: number }) {
  const steps = ['Building grounded context from computed metrics', 'Asking Claude for a structured report', 'Verifying every claim against the data'];
  const step = Math.min(steps.length - 1, Math.floor(elapsed / 8));
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center" role="status" aria-live="polite">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon.sparkle size={24} className="pulse-dot" />
      </span>
      <div>
        <p className="font-medium">Generating {what}…</p>
        <p className="mt-1 text-sm text-muted">{steps[step]} · {elapsed}s (usually 10–40 s)</p>
      </div>
      <div className="w-full max-w-sm">
        <ProgressBar value={Math.min(0.95, elapsed / 35)} label={`Generating ${what}`} />
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function ReportBody({
  report,
  resolve,
  playerName,
}: {
  report: MatchReport;
  resolve: SubjectResolver;
  playerName: (id: string) => string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{report.headline}</h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-text-2">{report.summary}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <Section title="In possession" icon={<Icon.ball size={14} />}>
            <ClaimList claims={report.tacticalBreakdown.inPossession} resolve={resolve} />
          </Section>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <Section title="Out of possession" icon={<Icon.shield size={14} />}>
            <ClaimList claims={report.tacticalBreakdown.outOfPossession} resolve={resolve} />
          </Section>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <Section title="Transitions" icon={<Icon.bolt size={14} />}>
            <ClaimList claims={report.tacticalBreakdown.transitions} resolve={resolve} />
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Standout players" icon={<Icon.players size={14} />}>
          {report.standoutPlayers.length ? (
            <ul className="divide-y divide-border">
              {report.standoutPlayers.map((sp, i) => (
                <li key={i} className="py-3">
                  <Link href={`/players/${sp.playerId}`} className="text-sm font-semibold text-accent hover:underline">
                    {playerName(sp.playerId)}
                  </Link>
                  <p className="mt-0.5 text-sm leading-relaxed">{sp.reason.text}</p>
                  <EvidenceChips evidence={sp.reason.evidence} resolve={resolve} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No standout players highlighted.</p>
          )}
        </Section>
        <Section title="Concerns" icon={<Icon.alert size={14} />}>
          <ClaimList claims={report.concerns} resolve={resolve} empty="No major concerns flagged." />
        </Section>
      </div>

      <Section title="Training focus" icon={<Icon.target size={14} />}>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {report.trainingFocus.map((t, i) => (
            <article key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
              <div className="flex items-center gap-2">
                <span className="tabular grid h-6 w-6 place-items-center rounded-md bg-accent-soft text-xs font-bold text-accent">
                  {i + 1}
                </span>
                <h4 className="text-sm font-semibold">{t.theme}</h4>
              </div>
              <p className="text-sm">
                <span className="text-muted">Drill · </span>
                {t.drill}
              </p>
              <p className="text-xs leading-relaxed text-text-2">{t.rationale}</p>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function MatchReportPanel({
  matchId,
  home,
  away,
  analysed,
  resolve,
  playerName,
}: {
  matchId: string;
  home: Team;
  away: Team;
  analysed: boolean;
  resolve: SubjectResolver;
  playerName: (id: string) => string;
}) {
  const [teamId, setTeamId] = useState(home.id);
  const qc = useQueryClient();
  const query = useQuery({ ...q.matchReport(matchId, teamId), enabled: analysed });
  const gen = useMutation({
    mutationFn: () => api.generateMatchReport(matchId, teamId),
    onSuccess: (data) => qc.setQueryData(q.matchReport(matchId, teamId).queryKey, data),
  });
  const elapsed = useElapsed(gen.isPending);

  let body: ReactNode;
  if (!analysed) body = <EmptyState title="Report not available yet" body="The AI report is generated once the match has been analysed." />;
  else if (gen.isPending) body = <GeneratingState what="the match report" elapsed={elapsed} />;
  else if (query.isPending) body = <LoadingBlock rows={5} label="Loading report" />;
  else if (query.error) body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  else if (!query.data)
    body = (
      <EmptyState
        icon={<Icon.sparkle />}
        title="No AI report for this team yet"
        body="Claude narrates the computed metrics into a coach-ready report. Every claim is checked against the data."
        action={
          <Button variant="primary" onClick={() => gen.mutate()}>
            <Icon.sparkle size={16} /> Generate AI report
          </Button>
        }
      />
    );
  else
    body = (
      <>
        <ReportBody report={query.data.report} resolve={resolve} playerName={playerName} />
        <ProvenanceFooter meta={query.data.meta} />
      </>
    );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            size="sm"
            label="Report focus team"
            value={teamId}
            onChange={(id) => {
              setTeamId(id);
              gen.reset();
            }}
            tabs={[
              { id: home.id, label: home.name },
              { id: away.id, label: away.name },
            ]}
          />
          {query.data && <GroundingBadge grounding={query.data.meta.grounding} />}
        </div>
        {query.data && !gen.isPending && (
          <Button size="sm" variant="ghost" onClick={() => gen.mutate()}>
            <Icon.refresh size={14} /> Regenerate
          </Button>
        )}
      </div>
      {gen.error && (
        <div className="mb-4 card">
          <ErrorState error={gen.error} compact onRetry={() => gen.mutate()} />
        </div>
      )}
      {body}
    </div>
  );
}
