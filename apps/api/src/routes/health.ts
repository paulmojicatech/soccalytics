import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponse, routes } from '@soccalytics/contracts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Liveness. */
  app.get('/livez', { schema: { hide: true } }, async () => ({ ok: true }));

  /** Readiness: dependencies reachable. AI is reported but never blocks readiness. */
  app.get(routes.health, { schema: { tags: ['ops'], response: { 200: HealthResponse, 503: HealthResponse } } }, async (_req, reply) => {
    const [db, redis, storage] = await Promise.all([
      app.c.dbh.ping(),
      app.c.jobEvents.ping().catch(() => false),
      app.c.storage.ping(),
    ]);
    const checks = {
      database: db ? 'ok' : 'fail',
      redis: redis ? 'ok' : 'fail',
      storage: storage ? 'ok' : 'fail',
      ai: app.c.ai.online ? 'ok' : 'fail',
    } as const;
    const ok = db && redis && storage;
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', checks, version: '0.1.0' });
  });
};
