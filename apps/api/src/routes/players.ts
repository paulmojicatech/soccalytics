import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  BenchmarkQuery,
  PlayerBenchmark,
  PlayerDetail,
  PlayerTrend,
  SimilarPlayer,
  StoredPlayerEvaluation,
} from '@soccalytics/contracts';

const Params = z.object({ id: z.string() });

export const playerRoutes: FastifyPluginAsyncZod = async (app) => {
  const { insights, repos, env } = app.c;

  app.get('/v1/players/:id', { schema: { tags: ['players'], params: Params, response: { 200: PlayerDetail } } }, (req) =>
    insights.playerDetail(req.params.id),
  );

  app.get(
    '/v1/players/:id/benchmark',
    { schema: { tags: ['players'], params: Params, querystring: BenchmarkQuery, response: { 200: PlayerBenchmark } } },
    (req) => insights.benchmark(req.params.id, req.query.cohort),
  );

  app.get('/v1/players/:id/trend', { schema: { tags: ['players'], params: Params, response: { 200: PlayerTrend } } }, (req) =>
    insights.trend(req.params.id),
  );

  app.get(
    '/v1/players/:id/similar',
    { schema: { tags: ['players'], params: Params, response: { 200: z.array(SimilarPlayer) } } },
    (req) => repos.profiles.similar(req.params.id, 8),
  );

  app.get(
    '/v1/players/:id/evaluation',
    { schema: { tags: ['ai'], params: Params, response: { 200: StoredPlayerEvaluation } } },
    async (req, reply) => (await repos.reports.getPlayerEvaluation(req.params.id)) ?? reply.notFound('No evaluation yet'),
  );

  app.post(
    '/v1/players/:id/evaluation',
    {
      schema: { tags: ['ai'], params: Params, response: { 200: StoredPlayerEvaluation } },
      config: { rateLimit: { max: env.AI_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } },
    },
    (req) => insights.playerEvaluation(req.params.id),
  );

};
