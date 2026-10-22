'use client';

import type { Team } from '@soccalytics/contracts';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Icon } from '../../components/icons';
import { JobPipeline, useJobProgress } from '../../components/JobPipeline';
import { Button, Card, ErrorState, Field, LinkButton, PageHeader, ProgressBar, Skeleton, inputClass } from '../../components/ui';
import { api, uploadFile } from '../../lib/api';
import { q } from '../../lib/queries';

interface Run {
  kind: 'video' | 'simulation';
  matchId: string;
  jobId: string;
  label: string;
}

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function TeamSelects({
  teams,
  home,
  away,
  setHome,
  setAway,
  idPrefix,
}: {
  teams: Team[];
  home: string;
  away: string;
  setHome: (v: string) => void;
  setAway: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Home team" htmlFor={`${idPrefix}-home`}>
        <select id={`${idPrefix}-home`} className={inputClass} value={home} onChange={(e) => setHome(e.target.value)} required>
          <option value="" disabled>
            Select…
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id} disabled={t.id === away}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Away team" htmlFor={`${idPrefix}-away`}>
        <select id={`${idPrefix}-away`} className={inputClass} value={away} onChange={(e) => setAway(e.target.value)} required>
          <option value="" disabled>
            Select…
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id} disabled={t.id === home}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function useTeamPair(teams: Team[] | undefined, offset = 0) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  useEffect(() => {
    if (teams && teams.length >= 2 && !home && !away) {
      setHome(teams[offset % teams.length].id);
      setAway(teams[(offset + 1) % teams.length].id);
    }
  }, [teams, home, away, offset]);
  return { home, away, setHome, setAway };
}

function UploadCard({ teams, onStarted, disabled }: { teams: Team[]; onStarted: (r: Run) => void; disabled: boolean }) {
  const pair = useTeamPair(teams);
  const [kickoff, setKickoff] = useState(localNow);
  const [competition, setCompetition] = useState('League');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'creating' | 'uploading' | 'starting'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileId = useId();

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setFileError('Please choose a video file (MP4, MOV, …).');
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !pair.home || !pair.away) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase('creating');
      const created = await api.createUpload({
        homeTeamId: pair.home,
        awayTeamId: pair.away,
        kickoffAt: new Date(kickoff).toISOString(),
        competition: competition.trim() || 'Friendly',
        fileName: file.name,
        contentType: file.type,
      });
      setPhase('uploading');
      setProgress(0);
      await uploadFile(created.uploadUrl, file, setProgress, controller.signal);
      setPhase('starting');
      const job = await api.startProcessing(created.matchId, created.videoKey);
      const h = teams.find((t) => t.id === pair.home)?.shortName ?? 'Home';
      const a = teams.find((t) => t.id === pair.away)?.shortName ?? 'Away';
      onStarted({ kind: 'video', matchId: job.matchId, jobId: job.jobId, label: `${h} v ${a} · ${file.name}` });
      setFile(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err);
    } finally {
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';
  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon.video size={16} className="text-accent" /> Upload match video
        </span>
      }
      subtitle="Computer vision detects players & ball, tracks them and infers every event — no manual tagging."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TeamSelects teams={teams} idPrefix="up" {...pair} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Kick-off" htmlFor="up-kickoff">
            <input
              id="up-kickoff"
              type="datetime-local"
              className={inputClass}
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
              required
            />
          </Field>
          <Field label="Competition" htmlFor="up-comp">
            <input id="up-comp" className={inputClass} value={competition} onChange={(e) => setCompetition(e.target.value)} required />
          </Field>
        </div>

        <div>
          <label htmlFor={fileId} className="mb-1.5 block text-xs font-medium text-text-2">
            Match footage
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={clsx(
              'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
              drag ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-2',
            )}
          >
            <input
              ref={inputRef}
              id={fileId}
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-3 text-text-2">
              <Icon.analyse size={18} />
            </span>
            {file ? (
              <p className="text-sm">
                <span className="font-medium">{file.name}</span> <span className="text-muted">· {sizeMb} MB</span>
              </p>
            ) : (
              <p className="text-sm text-text-2">Drag & drop a video here</p>
            )}
            <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {file ? 'Choose another file' : 'Browse files'}
            </Button>
            <p className="text-xs text-muted">Wide-angle broadcast or tactical camera works best</p>
          </div>
          {fileError && (
            <p role="alert" className="mt-1.5 text-xs text-critical-text">
              {fileError}
            </p>
          )}
        </div>

        {phase === 'uploading' && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-text-2">
              <span>Uploading to storage…</span>
              <span className="tabular">{Math.round(progress * 100)}%</span>
            </div>
            <ProgressBar value={progress} label="Upload progress" />
          </div>
        )}
        {!!error && <ErrorState error={error} compact />}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={busy} disabled={!file || !pair.home || !pair.away || disabled}>
            <Icon.play size={14} />
            {phase === 'creating'
              ? 'Preparing upload…'
              : phase === 'uploading'
                ? 'Uploading…'
                : phase === 'starting'
                  ? 'Starting analysis…'
                  : 'Upload & analyse'}
          </Button>
          {phase === 'uploading' && (
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function SimulateCard({
  teams,
  onStarted,
  highlight,
}: {
  teams: Team[];
  onStarted: (r: Run) => void;
  highlight: boolean;
}) {
  const pair = useTeamPair(teams, 2);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pair.home || !pair.away) return;
    setBusy(true);
    setError(null);
    try {
      const parsedSeed = seed.trim() === '' ? undefined : Number.parseInt(seed, 10);
      const job = await api.simulate({
        homeTeamId: pair.home,
        awayTeamId: pair.away,
        seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
      });
      const h = teams.find((t) => t.id === pair.home)?.shortName ?? 'Home';
      const a = teams.find((t) => t.id === pair.away)?.shortName ?? 'Away';
      onStarted({ kind: 'simulation', matchId: job.matchId, jobId: job.jobId, label: `${h} v ${a} · simulated` });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className={clsx('rounded-[15px]', highlight && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}>
      <Card
        className="h-full"
        title={
          <span className="flex items-center gap-2">
            <Icon.dice size={16} className="text-accent" /> Simulate a match
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Demo mode
            </span>
          </span>
        }
        subtitle="A seeded engine generates realistic tracking + events, then runs the full analytics and AI pipeline. No GPU needed."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TeamSelects teams={teams} idPrefix="sim" {...pair} />
          <Field label="Seed (optional)" htmlFor="sim-seed" hint="Same seed + teams = same match. Leave blank for a random fixture.">
            <div className="flex gap-2">
              <input
                id="sim-seed"
                inputMode="numeric"
                pattern="-?[0-9]*"
                className={inputClass}
                placeholder="Random"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
              <Button
                variant="secondary"
                aria-label="Randomise seed"
                onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000)))}
              >
                <Icon.dice size={16} />
              </Button>
            </div>
          </Field>
          {!!error && <ErrorState error={error} compact />}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!pair.home || !pair.away}>
              <Icon.play size={14} /> Run simulation
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function RunProgress({ run }: { run: Run }) {
  const { job, live, error } = useJobProgress(run.jobId);
  const done = job?.status === 'completed';
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {run.kind === 'video' ? <Icon.video size={16} /> : <Icon.dice size={16} />} {run.label}
        </span>
      }
      subtitle="Pipeline: ingest → detect → track → events → metrics → report"
      actions={
        <LinkButton href={`/matches/${run.matchId}`} variant={done ? 'primary' : 'secondary'} size="sm">
          {done ? 'Open match centre' : 'View match'} <Icon.arrowRight size={14} />
        </LinkButton>
      }
    >
      {!!error && !job ? <ErrorState error={error} compact /> : <JobPipeline job={job} live={live} />}
    </Card>
  );
}

export function AnalyseView({ initialMode }: { initialMode: 'upload' | 'simulate' }) {
  const teams = useQuery(q.teams());
  const [runs, setRuns] = useState<Run[]>([]);
  const progressRef = useRef<HTMLDivElement>(null);

  const onStarted = (r: Run) => {
    setRuns((prev) => [r, ...prev]);
    setTimeout(() => progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <>
      <PageHeader
        eyebrow="Analyse"
        title="From footage to insight"
        subtitle="Upload a match video or simulate one. Watch every stage of the pipeline live."
      />
      {teams.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[380px]" />
        </div>
      ) : teams.error || !teams.data ? (
        <div className="card">
          <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
        </div>
      ) : teams.data.length < 2 ? (
        <div className="card p-6 text-sm text-muted">At least two teams are needed. Seed the database first.</div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <UploadCard teams={teams.data} onStarted={onStarted} disabled={false} />
          <SimulateCard teams={teams.data} onStarted={onStarted} highlight={initialMode === 'simulate'} />
        </div>
      )}

      {runs.length > 0 && (
        <div ref={progressRef} className="mt-6 flex scroll-mt-6 flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Live pipeline</h2>
          {runs.map((r) => (
            <RunProgress key={r.jobId} run={r} />
          ))}
        </div>
      )}
    </>
  );
}
