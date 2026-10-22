import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateUploadRequest,
  CreateUploadResponse,
  JobCreatedResponse,
  ProcessingJob,
  SimulateMatchRequest,
  StartProcessingRequest,
  type JobStage,
} from '@soccalytics/contracts';
import { newId } from '@soccalytics/platform';
import { openSse } from '../services/sse.js';

const VIDEO_STAGES: JobStage[] = ['ingest', 'detect', 'track', 'events', 'metrics', 'report'];
const SIM_STAGES: JobStage[] = ['events', 'metrics', 'report'];
const Params = z.object({ id: z.string() });

export const pipelineRoutes: FastifyPluginAsyncZod = async (app) => {
  const { repos, storage, queues, jobEvents } = app.c;

  async function assertTeams(homeTeamId: string, awayTeamId: string) {
    if (homeTeamId === awayTeamId) throw app.httpErrors.badRequest('Home and away teams must differ');
    const [h, a] = await Promise.all([repos.teams.get(homeTeamId), repos.teams.get(awayTeamId)]);
    if (!h || !a) throw app.httpErrors.badRequest('Unknown team');
  }

  /** Step 1 of video analysis: create the match and a presigned upload URL. */
  app.post(
    '/v1/uploads',
    { schema: { tags: ['pipeline'], body: CreateUploadRequest, response: { 200: CreateUploadResponse } } },
    async (req) => {
      const b = req.body;
      await assertTeams(b.homeTeamId, b.awayTeamId);
      const matchId = newId('match');
      const ext = b.fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
      const videoKey = `videos/${matchId}/source.${ext}`;
      await repos.matches.create({
        id: matchId,
        homeTeamId: b.homeTeamId,
        awayTeamId: b.awayTeamId,
        kickoffAt: b.kickoffAt,
        competition: b.competition,
        venue: null,
        status: 'scheduled',
        source: 'video_upload',
        homeScore: null,
        awayScore: null,
        durationSec: null,
        videoKey,
      });
      return { matchId, videoKey, uploadUrl: await storage.presignPut(videoKey, b.contentType) };
    },
  );

  /** Step 2: after the browser PUTs the file, kick off the CV pipeline. */
  app.post(
    '/v1/matches/:id/process',
    { schema: { tags: ['pipeline'], params: Params, body: StartProcessingRequest, response: { 200: JobCreatedResponse } } },
    async (req, reply) => {
      const match = await repos.matches.get(req.params.id);
      if (!match) return reply.notFound('Match not found');
      const keys = await repos.matches.keys(match.id);
      if (keys?.videoKey !== req.body.videoKey) return reply.badRequest('videoKey does not belong to this match');
      const job = await repos.jobs.create({ id: newId('job'), matchId: match.id, kind: 'video', stages: VIDEO_STAGES });
      await repos.matches.update(match.id, { status: 'processing' });
      await queues.enqueueVision({
        jobId: job.id,
        matchId: match.id,
        videoKey: req.body.videoKey,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        calibration: null,
      });
      return { matchId: match.id, jobId: job.id };
    },
  );

  /** Demo mode: synthesise a match end-to-end (no footage needed). */
  app.post(
    '/v1/simulations',
    { schema: { tags: ['pipeline'], body: SimulateMatchRequest, response: { 200: JobCreatedResponse } } },
    async (req) => {
      const b = req.body;
      await assertTeams(b.homeTeamId, b.awayTeamId);
      const matchId = newId('match');
      await repos.matches.create({
        id: matchId,
        homeTeamId: b.homeTeamId,
        awayTeamId: b.awayTeamId,
        kickoffAt: new Date().toISOString(),
        competition: 'Simulation',
        venue: null,
        status: 'processing',
        source: 'simulation',
        homeScore: null,
        awayScore: null,
        durationSec: null,
      });
      const job = await repos.jobs.create({ id: newId('job'), matchId, kind: 'simulation', stages: SIM_STAGES });
      await queues.enqueueAnalytics({ task: 'simulate', jobId: job.id, matchId, seed: b.seed ?? Math.floor(Math.random() * 1e9) });
      return { matchId, jobId: job.id };
    },
  );

  app.get('/v1/jobs/:id', { schema: { tags: ['pipeline'], params: Params, response: { 200: ProcessingJob } } }, async (req, reply) => {
    return (await repos.jobs.get(req.params.id)) ?? reply.notFound('Job not found');
  });

  /** Live job progress over SSE: replays current state, then relays Redis pub/sub. */
  app.get('/v1/jobs/:id/stream', { schema: { tags: ['pipeline'], params: Params } }, async (req, reply) => {
    const job = await repos.jobs.get(req.params.id);
    if (!job) return reply.notFound('Job not found');
    const sse = openSse(req, reply);
    const done = (s: string) => s === 'completed' || s === 'failed';

    // Subscribe first so nothing is missed between the snapshot and the subscription.
    const unsubscribe = jobEvents.subscribe(job.id, async (e) => {
      sse.send(e);
      if (done(e.status)) {
        const latest = await repos.jobs.get(job.id);
        if (latest && done(latest.status)) {
          unsubscribe();
          sse.end();
        }
      }
    });
    sse.onClose(unsubscribe);

    for (const st of job.stages) {
      sse.send({ jobId: job.id, stage: st.stage, status: st.status, progress: st.progress, message: st.message });
    }
    if (done(job.status)) {
      unsubscribe();
      sse.end();
    }
  });
};
