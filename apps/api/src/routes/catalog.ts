import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MatchSummary, Overview, PlayerListItem, Position, Team, routes } from '@soccalytics/contracts';

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  const { repos } = app.c;

  app.get(routes.overview, { schema: { tags: ['catalog'], response: { 200: Overview } } }, async () => {
    const [counts, matchesAnalysed, eventsDetected, recentMatches, activeJobs, topPerformers] = await Promise.all([
      repos.overview.counts(),
      repos.matches.countAnalysed(),
      repos.events.count(),
      repos.matches.list({ limit: 6 }),
      repos.jobs.active(),
      repos.overview.topPerformers(5),
    ]);
    return { ...counts, matchesAnalysed, eventsDetected, recentMatches, activeJobs, topPerformers };
  });

  app.get(routes.teams, { schema: { tags: ['catalog'], response: { 200: z.array(Team) } } }, () => repos.teams.list());

  app.get(
    routes.players,
    {
      schema: {
        tags: ['players'],
        querystring: z.object({ position: Position.optional(), teamId: z.string().optional(), q: z.string().max(80).optional() }),
        response: { 200: z.array(PlayerListItem) },
      },
    },
    (req) => repos.players.list(req.query),
  );

  app.get(
    routes.matches,
    {
      schema: {
        tags: ['matches'],
        querystring: z.object({ teamId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: { 200: z.array(MatchSummary) },
      },
    },
    (req) => repos.matches.list(req.query),
  );
};
