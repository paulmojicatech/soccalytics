import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { AiError } from '@soccalytics/ai';
import type { ApiEnv } from './config.js';
import type { Container } from './services/container.js';
import { NotFoundError } from './services/insights.js';
import { healthRoutes } from './routes/health.js';
import { catalogRoutes } from './routes/catalog.js';
import { playerRoutes } from './routes/players.js';
import { matchRoutes } from './routes/matches.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { aiRoutes } from './routes/ai.js';

declare module 'fastify' {
  interface FastifyInstance {
    c: Container;
  }
}

export async function buildApp(env: ApiEnv, container: Container) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      redact: ['req.headers.authorization'],
    },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('c', container);

  await app.register(sensible);
  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), credentials: true });
  await app.register(rateLimit, { max: env.RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Soccalytics API', version: '0.1.0', description: 'AI-powered soccer analytics' },
      tags: [
        { name: 'catalog' },
        { name: 'players' },
        { name: 'matches' },
        { name: 'pipeline' },
        { name: 'ai' },
        { name: 'ops' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: err.message, requestId: req.id });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: err.message, requestId: req.id });
    }
    if (err instanceof AiError) {
      req.log.warn({ code: err.code }, err.message);
      const status = err.code === 'refusal' ? 422 : 502;
      return reply.code(status).send({ statusCode: status, error: 'AI Error', message: err.message, requestId: req.id });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      statusCode: status,
      error: status >= 500 ? 'Internal Server Error' : (err.name ?? 'Error'),
      message: status >= 500 ? 'Something went wrong' : err.message,
      requestId: req.id,
    });
  });

  await app.register(healthRoutes);
  await app.register(catalogRoutes);
  await app.register(playerRoutes);
  await app.register(matchRoutes);
  await app.register(pipelineRoutes);
  await app.register(aiRoutes);
  return app;
}
export type App = Awaited<ReturnType<typeof buildApp>>;
