import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AssistantRequest, ScoutSearchRequest, ScoutSearchResponse, type AssistantStreamEvent } from '@soccalytics/contracts';
import { runAssistant } from '@soccalytics/ai';
import { openSse } from '../services/sse.js';

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  const { insights, ai, env } = app.c;
  const aiLimit = { rateLimit: { max: env.AI_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } };

  app.post(
    '/v1/scouting/search',
    { schema: { tags: ['ai'], body: ScoutSearchRequest, response: { 200: ScoutSearchResponse } }, config: aiLimit },
    (req) => insights.scoutSearch(req.body.query, req.body.limit),
  );

  /** Streaming analyst assistant (SSE over POST). */
  app.post('/v1/assistant/chat', { schema: { tags: ['ai'], body: AssistantRequest }, config: aiLimit }, async (req, reply) => {
    const sse = openSse(req, reply);
    const abort = new AbortController();
    sse.onClose(() => abort.abort());
    await runAssistant(
      ai,
      req.body,
      insights.assistantTools,
      (e: AssistantStreamEvent) => sse.send(e),
      abort.signal,
    );
    sse.end();
  });
};
