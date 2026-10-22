'use client';

import { JobStage, type JobStreamEvent, type ProcessingJob, type StageState } from '@soccalytics/contracts';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { api, subscribeToJob } from '../lib/api';
import { Icon } from './icons';
import { ProgressBar, Spinner } from './ui';

const STAGE_META: Record<JobStage, { label: string; detail: string }> = {
  ingest: { label: 'Ingest', detail: 'Video to object storage' },
  detect: { label: 'Detect', detail: 'YOLO players & ball' },
  track: { label: 'Track', detail: 'ByteTrack + homography' },
  events: { label: 'Events', detail: 'Passes, shots, pressures' },
  metrics: { label: 'Metrics', detail: 'xG, xT, PPDA, ratings' },
  report: { label: 'AI report', detail: 'Grounded Claude summary' },
};

type DisplayStatus = StageState['status'] | 'skipped';

function applyEvent(job: ProcessingJob, e: JobStreamEvent): ProcessingJob {
  const now = new Date().toISOString();
  const exists = job.stages.some((s) => s.stage === e.stage);
  const stages = exists
    ? job.stages.map((s) =>
        s.stage === e.stage
          ? {
              ...s,
              status: e.status,
              progress: e.status === 'completed' ? 1 : e.progress,
              message: e.message ?? s.message,
              startedAt: s.startedAt ?? now,
              finishedAt: e.status === 'completed' || e.status === 'failed' ? now : s.finishedAt,
            }
          : s,
      )
    : [
        ...job.stages,
        { stage: e.stage, status: e.status, progress: e.progress, message: e.message, startedAt: now, finishedAt: null },
      ];
  // A stage starting implies all earlier stages are done.
  const order = JobStage.options;
  const idx = order.indexOf(e.stage);
  const normalised = stages.map((s) =>
    order.indexOf(s.stage) < idx && s.status !== 'completed' && s.status !== 'failed'
      ? { ...s, status: 'completed' as const, progress: 1 }
      : s,
  );
  const failed = e.status === 'failed';
  const done = e.stage === 'report' && e.status === 'completed';
  return {
    ...job,
    stages: normalised,
    status: failed ? 'failed' : done ? 'completed' : 'running',
    error: failed ? (e.message ?? 'Processing failed') : job.error,
    updatedAt: now,
  };
}

/**
 * Live job state: initial GET, then SSE updates; falls back to polling if the
 * stream drops. Invalidates match/overview queries when the job finishes.
 */
export function useJobProgress(jobId: string | null | undefined, initial?: ProcessingJob | null) {
  const [job, setJob] = useState<ProcessingJob | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [live, setLive] = useState(false);
  const qc = useQueryClient();
  const jobRef = useRef(job);
  jobRef.current = job;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const finish = async () => {
      try {
        const fresh = await api.job(jobId);
        if (!cancelled) setJob(fresh);
      } catch {
        // keep the streamed state
      }
      setLive(false);
      void qc.invalidateQueries({ queryKey: ['match', jobRef.current?.matchId ?? ''] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void qc.invalidateQueries({ queryKey: ['matches'] });
    };

    const startPolling = () => {
      poll = setInterval(async () => {
        try {
          const fresh = await api.job(jobId);
          if (cancelled) return;
          setJob(fresh);
          if (fresh.status === 'completed' || fresh.status === 'failed') {
            if (poll) clearInterval(poll);
            void finish();
          }
        } catch (err) {
          setError(err);
        }
      }, 2500);
    };

    (async () => {
      try {
        const initialJob = await api.job(jobId);
        if (cancelled) return;
        setJob(initialJob);
        if (initialJob.status === 'completed' || initialJob.status === 'failed') return;
      } catch (err) {
        if (!cancelled) setError(err);
      }
      if (cancelled) return;
      setLive(true);
      unsubscribe = subscribeToJob(jobId, {
        onEvent: (e) => {
          setJob((prev) =>
            applyEvent(
              prev ?? {
                id: jobId,
                matchId: '',
                kind: 'video',
                status: 'running',
                stages: [],
                error: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              e,
            ),
          );
        },
        onEnd: () => void finish(),
        onError: () => {
          setLive(false);
          startPolling();
        },
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (poll) clearInterval(poll);
    };
  }, [jobId, qc]);

  return { job, error, live };
}

function stageDisplay(job: ProcessingJob | null, stage: JobStage): { status: DisplayStatus; state?: StageState } {
  const state = job?.stages.find((s) => s.stage === stage);
  if (state) return { status: state.status, state };
  if (job?.kind === 'simulation' && (stage === 'ingest' || stage === 'detect' || stage === 'track'))
    return { status: 'skipped' };
  if (job?.status === 'completed') return { status: 'skipped' };
  return { status: 'queued' };
}

/** Horizontal (desktop) / vertical (mobile) stepper for the processing pipeline. */
export function JobPipeline({ job, live }: { job: ProcessingJob | null; live?: boolean }) {
  const stages = JobStage.options;
  const counted = stages.filter((s) => stageDisplay(job, s).status !== 'skipped');
  const overall = counted.length
    ? counted.reduce((acc, s) => {
        const d = stageDisplay(job, s);
        return acc + (d.status === 'completed' ? 1 : (d.state?.progress ?? 0));
      }, 0) / counted.length
    : 0;
  const status = job?.status ?? 'queued';
  const current = stages.find((s) => stageDisplay(job, s).status === 'running');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          {status === 'completed' ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-good-text">
              <Icon.check size={16} /> Analysis complete
            </span>
          ) : status === 'failed' ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-critical-text">
              <Icon.x size={16} /> Processing failed
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 font-medium">
              <Spinner className="h-4 w-4 text-accent" />
              {current ? `${STAGE_META[current].label}…` : 'Queued…'}
            </span>
          )}
          {live && status !== 'completed' && status !== 'failed' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Live
            </span>
          )}
        </div>
        <span className="tabular text-xs text-muted">{Math.round(overall * 100)}%</span>
      </div>
      <ProgressBar value={overall} label="Overall processing progress" tone={status === 'failed' ? 'critical' : 'accent'} />

      <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((s, i) => {
          const { status: st, state } = stageDisplay(job, s);
          return (
            <li
              key={s}
              className={clsx(
                'relative rounded-lg border px-3 py-2.5',
                st === 'running' ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2',
                st === 'skipped' && 'opacity-50',
              )}
              aria-current={st === 'running' ? 'step' : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                    st === 'completed' && 'bg-good text-white',
                    st === 'running' && 'bg-accent text-accent-ink',
                    st === 'failed' && 'bg-critical text-white',
                    (st === 'queued' || st === 'skipped') && 'bg-surface-3 text-muted',
                  )}
                >
                  {st === 'completed' ? <Icon.check size={12} strokeWidth={3} /> : st === 'failed' ? '!' : i + 1}
                </span>
                <span className="text-sm font-medium">{STAGE_META[s].label}</span>
                <span className="sr-only">
                  {st === 'skipped' ? 'skipped' : st}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted" title={state?.message ?? STAGE_META[s].detail}>
                {st === 'skipped' ? 'Not needed for simulation' : (state?.message ?? STAGE_META[s].detail)}
              </p>
              {st === 'running' && (
                <div className="mt-2">
                  <ProgressBar value={state?.progress ?? 0} label={`${STAGE_META[s].label} progress`} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {job?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-text">
          {job.error}
        </p>
      )}
    </div>
  );
}

/** Self-contained live pipeline for a job id. */
export function LiveJob({ jobId, initial }: { jobId: string; initial?: ProcessingJob | null }) {
  const { job, live } = useJobProgress(jobId, initial);
  return <JobPipeline job={job} live={live} />;
}
