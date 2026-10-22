import { startTelemetry } from '@soccalytics/platform';
// Telemetry must start before fastify/pg/ioredis are loaded to instrument them.
const stopTelemetry = startTelemetry('soccalytics-api');

const { loadConfig } = await import('./config.js');
const { createContainer } = await import('./services/container.js');
const { buildApp } = await import('./app.js');

const env = loadConfig();
const container = createContainer(env);
const app = await buildApp(env, container);

await container.storage.ensureBucket().catch((err) => app.log.warn({ err }, 'object storage unavailable at boot'));
await app.listen({ host: env.API_HOST, port: env.API_PORT });

// A stray rejection in a background callback (e.g. a dropped Redis socket) should be logged, not take the API down.
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await container.close();
    await stopTelemetry();
    process.exit(0);
  });
}
