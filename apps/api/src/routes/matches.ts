import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { EventType, GenerateReportRequest, MatchDetail, MatchEvent, MatchEventsQuery, StoredMatchReport } from '@soccalytics/contracts';

const Params = z.object({ id: z.string() });

export const matchRoutes: FastifyPluginAsyncZod = async (app) => {
  const { repos, insights, env } = app.c;

  app.get('/v1/matches/:id', { schema: { tags: ['matches'], params: Params, response: { 200: MatchDetail } } }, async (req, reply) => {
    const match = await repos.matches.summary(req.params.id);
    if (!match) return reply.notFound('Match not found');
    const [lineups, teamStats, playerStats, latestJob] = await Promise.all([
      repos.lineups.byMatch(match.id),
      repos.stats.teamsByMatch(match.id),
      repos.stats.playersByMatch(match.id),
      repos.jobs.latestForMatch(match.id),
    ]);
    return { match, lineups, teamStats, playerStats, latestJob };
  });

  app.get(
    '/v1/matches/:id/events',
    { schema: { tags: ['matches'], params: Params, querystring: MatchEventsQuery, response: { 200: z.array(MatchEvent) } } },
    (req) => {
      const types = req.query.types
        ?.split(',')
        .map((t) => t.trim())
        .filter((t) => EventType.safeParse(t).success);
      return repos.events.byMatch(req.params.id, { types, playerId: req.query.playerId });
    },
  );

  app.get(
    '/v1/matches/:id/report',
    { schema: { tags: ['ai'], params: Params, querystring: GenerateReportRequest, response: { 200: StoredMatchReport } } },
    async (req, reply) => (await repos.reports.getMatchReport(req.params.id, req.query.teamId)) ?? reply.notFound('No report yet'),
  );

  app.post(
    '/v1/matches/:id/report',
    {
      schema: { tags: ['ai'], params: Params, body: GenerateReportRequest, response: { 200: StoredMatchReport } },
      config: { rateLimit: { max: env.AI_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } },
    },
    (req) => insights.matchReport(req.params.id, req.body.teamId),
  );
};
