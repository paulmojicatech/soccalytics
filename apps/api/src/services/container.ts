import { createDb, createRepositories, type DbHandle, type Repositories } from '@soccalytics/db';
import { aiConfigFromEnv, createGateway, type Gateway } from '@soccalytics/ai';
import {
  createJobEvents,
  createQueues,
  createStorage,
  type JobEvents,
  type Queues,
  type Storage,
} from '@soccalytics/platform';
import type { ApiEnv } from '../config.js';
import { createInsights, type Insights } from './insights.js';

export interface Container {
  env: ApiEnv;
  dbh: DbHandle;
  repos: Repositories;
  storage: Storage;
  queues: Queues;
  jobEvents: JobEvents;
  ai: Gateway;
  insights: Insights;
  close(): Promise<void>;
}

/** Composition root: every external dependency is created here, once. */
export function createContainer(env: ApiEnv): Container {
  const dbh = createDb(env.DATABASE_URL);
  const repos = createRepositories(dbh.db);
  const storage = createStorage(env);
  const queues = createQueues(env.REDIS_URL);
  const jobEvents = createJobEvents(env.REDIS_URL);
  const ai = createGateway(aiConfigFromEnv(), (record) => repos.llmCalls.record(record));
  const insights = createInsights(repos, ai);

  return {
    env,
    dbh,
    repos,
    storage,
    queues,
    jobEvents,
    ai,
    insights,
    async close() {
      await Promise.allSettled([queues.close(), jobEvents.close(), dbh.close()]);
    },
  };
}
