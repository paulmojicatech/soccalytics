import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from './app.js';
import { ApiEnv } from './config.js';
import type { Container } from './services/container.js';

const env = ApiEnv.parse({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgres://x:y@localhost:1/z',
  REDIS_URL: 'redis://localhost:1',
});

/** Hand-rolled fakes: route tests don't need real infrastructure. */
const container = {
  env,
  dbh: { ping: async () => true },
  jobEvents: { ping: async () => true },
  storage: { ping: async () => false },
  ai: { online: false },
  repos: {
    teams: { list: async () => [], get: async () => null },
    matches: { summary: async () => null },
  },
} as unknown as Container;

describe('api', () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp(env, container);
  });
  afterAll(() => app.close());

  it('reports degraded readiness when a dependency is down', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { database: 'ok', storage: 'fail', ai: 'fail' } });
  });

  it('returns 404 with request id for missing matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/matches/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().requestId).toBeTruthy();
  });

  it('validates request bodies against contracts', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/simulations', payload: { homeTeamId: 'a' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects simulations between unknown teams', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/simulations', payload: { homeTeamId: 'a', awayTeamId: 'b' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Unknown team');
  });

  it('serves the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain('/v1/scouting/search');
  });
});
