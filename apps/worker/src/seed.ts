/**
 * Seeds a demo league and runs a full round-robin through the analytics
 * pipeline (simulate → events → metrics), so dashboards have history.
 *   pnpm nx run worker:seed            (SEED_MATCHES=28 by default)
 */
import { runMigrations, createDb, createRepositories } from '@soccalytics/db';
import { aiConfigFromEnv, createGateway } from '@soccalytics/ai';
import { createStorage, newId } from '@soccalytics/platform';
import { generateLeague } from '@soccalytics/simulator';
import { sql } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { createPipeline } from './pipeline.js';

const env = loadConfig();
const SEED = Number(process.env['SEED'] ?? 42);
const MATCHES = Number(process.env['SEED_MATCHES'] ?? 28);
const WITH_REPORTS = process.env['SEED_REPORTS'] === 'true';

await runMigrations(env.DATABASE_URL);
const dbh = createDb(env.DATABASE_URL);
const repos = createRepositories(dbh.db);
const storage = createStorage(env);
await storage.ensureBucket();
const ai = createGateway(aiConfigFromEnv(), (r) => repos.llmCalls.record(r));
const pipeline = createPipeline({ repos, storage, ai, log: () => undefined });

const existing = await repos.matches.list({ limit: 1 });
if (existing.length && process.env['SEED_RESET'] !== 'true') {
  console.log('Database already seeded. Re-run with SEED_RESET=true to wipe and reseed.');
  await dbh.close();
  process.exit(0);
}
if (existing.length) {
  await dbh.db.execute(sql`truncate matches, player_profiles, player_evaluations cascade`);
  console.log('✔ wiped existing matches');
}

const league = generateLeague(SEED);
await repos.teams.upsertMany(league.teams);
await repos.players.upsertMany(
  league.players.map(({ attributes, ...p }) => ({ ...p, latentAttributes: attributes as unknown as Record<string, number> })),
);
console.log(`✔ league: ${league.teams.length} teams, ${league.players.length} players`);

// Circle-method round robin, one fixture per week going back in time.
const ids = league.teams.map((t) => t.id);
const fixtures: [string, string][] = [];
for (let round = 0; round < ids.length - 1; round++) {
  for (let i = 0; i < ids.length / 2; i++) {
    const a = ids[i]!;
    const b = ids[ids.length - 1 - i]!;
    fixtures.push(round % 2 ? [a, b] : [b, a]);
  }
  ids.splice(1, 0, ids.pop()!);
}

const noop = async () => undefined;
const total = Math.min(MATCHES, fixtures.length);
const roundsBack = Math.ceil(total / (league.teams.length / 2));
for (let i = 0; i < total; i++) {
  const [home, away] = fixtures[i]!;
  const round = Math.floor(i / (league.teams.length / 2));
  const kickoff = new Date(Date.now() - (roundsBack - round) * 7 * 86_400_000);
  kickoff.setUTCHours(14, 0, 0, 0);
  const matchId = newId('match');
  const started = Date.now();
  await repos.matches.create({
    id: matchId,
    homeTeamId: home,
    awayTeamId: away,
    kickoffAt: kickoff.toISOString(),
    competition: 'Development League',
    venue: null,
    status: 'processing',
    source: 'simulation',
    homeScore: null,
    awayScore: null,
    durationSec: null,
  });
  await pipeline.simulate(matchId, SEED * 1000 + i, noop);
  await pipeline.metrics(matchId, noop);
  if (WITH_REPORTS) await pipeline.reports(matchId, noop, true);
  const m = await repos.matches.summary(matchId);
  console.log(
    `  [${String(i + 1).padStart(2)}/${total}] ${m!.homeTeam.shortName} ${m!.homeScore}–${m!.awayScore} ${m!.awayTeam.shortName}` +
      `  xG ${m!.homeXg?.toFixed(2)}–${m!.awayXg?.toFixed(2)}  (${Date.now() - started} ms)`,
  );
}
console.log('✔ seed complete');
await dbh.close();
process.exit(0);
