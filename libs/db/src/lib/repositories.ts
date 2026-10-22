import { and, cosineDistance, desc, eq, inArray, ne, sql, count } from 'drizzle-orm';
import type {
  AiArtifactMeta,
  Lineup,
  Match,
  MatchEvent,
  MatchReport,
  MatchSummary,
  Player,
  PlayerEvaluation,
  PlayerMatchStats,
  PlayerProfile,
  ProcessingJob,
  StageState,
  StoredMatchReport,
  StoredPlayerEvaluation,
  Team,
  TeamMatchStats,
  JobStage,
  JobStatus,
} from '@soccalytics/contracts';
import type { Db } from './client.js';
import * as s from './schema.js';

// ── mappers ────────────────────────────────────────────────────────────────

type TeamRow = typeof s.teams.$inferSelect;
type PlayerRow = typeof s.players.$inferSelect;
type MatchRow = typeof s.matches.$inferSelect;
type JobRow = typeof s.processingJobs.$inferSelect;
type EventRow = typeof s.events.$inferSelect;

const toTeam = (r: TeamRow): Team => ({
  id: r.id,
  name: r.name,
  shortName: r.shortName,
  level: r.level as Team['level'],
  primaryColor: r.primaryColor,
  secondaryColor: r.secondaryColor,
});

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  teamId: r.teamId,
  name: r.name,
  shirtNumber: r.shirtNumber,
  position: r.position as Player['position'],
  birthDate: r.birthDate,
  heightCm: r.heightCm,
  foot: r.foot as Player['foot'],
  nationality: r.nationality,
});

const toMatch = (r: MatchRow): Match => ({
  id: r.id,
  homeTeamId: r.homeTeamId,
  awayTeamId: r.awayTeamId,
  kickoffAt: r.kickoffAt.toISOString(),
  competition: r.competition,
  venue: r.venue,
  status: r.status as Match['status'],
  source: r.source as Match['source'],
  homeScore: r.homeScore,
  awayScore: r.awayScore,
  durationSec: r.durationSec,
});

const toJob = (r: JobRow): ProcessingJob => ({
  id: r.id,
  matchId: r.matchId,
  kind: r.kind as ProcessingJob['kind'],
  status: r.status as JobStatus,
  stages: r.stages,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toEvent = (r: EventRow): MatchEvent => ({
  id: r.id,
  matchId: r.matchId,
  teamId: r.teamId,
  playerId: r.playerId,
  period: r.period,
  t: r.t,
  type: r.type as MatchEvent['type'],
  start: r.start,
  end: r.end,
  success: r.success,
  bodyPart: r.bodyPart as MatchEvent['bodyPart'],
  playPattern: r.playPattern as MatchEvent['playPattern'],
  recipientId: r.recipientId,
  xg: r.xg,
  xt: r.xt,
  progressive: r.progressive,
  confidence: r.confidence,
});

export function ageOn(birthDate: string, at = new Date()): number {
  const b = new Date(birthDate);
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  const m = at.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Postgres rejects multi-row inserts with > 65k params; chunk bulk writes. */
async function insertChunked<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

// ── repositories ───────────────────────────────────────────────────────────

export function createRepositories(db: Db) {
  const teams = {
    async list(): Promise<Team[]> {
      return (await db.select().from(s.teams).orderBy(s.teams.name)).map(toTeam);
    },
    async get(id: string): Promise<Team | null> {
      const [r] = await db.select().from(s.teams).where(eq(s.teams.id, id));
      return r ? toTeam(r) : null;
    },
    async upsertMany(rows: Team[]) {
      if (!rows.length) return;
      await db
        .insert(s.teams)
        .values(rows)
        .onConflictDoUpdate({
          target: s.teams.id,
          set: { name: sql`excluded.name`, level: sql`excluded.level` },
        });
    },
  };

  const players = {
    async list(filter: { teamId?: string; position?: string; q?: string } = {}) {
      const where = and(
        filter.teamId ? eq(s.players.teamId, filter.teamId) : undefined,
        filter.position ? eq(s.players.position, filter.position) : undefined,
        filter.q ? sql`${s.players.name} ilike ${'%' + filter.q + '%'}` : undefined,
      );
      const rows = await db
        .select({ p: s.players, teamName: s.teams.name, profile: s.playerProfiles.profile })
        .from(s.players)
        .innerJoin(s.teams, eq(s.teams.id, s.players.teamId))
        .leftJoin(s.playerProfiles, eq(s.playerProfiles.playerId, s.players.id))
        .where(where)
        .orderBy(s.players.teamId, s.players.shirtNumber);
      return rows.map((r) => ({
        ...toPlayer(r.p),
        teamName: r.teamName,
        age: ageOn(r.p.birthDate),
        matches: r.profile?.matches ?? 0,
        minutes: r.profile?.minutes ?? 0,
        avgRating: r.profile?.avgRating ?? null,
      }));
    },
    async get(id: string): Promise<Player | null> {
      const [r] = await db.select().from(s.players).where(eq(s.players.id, id));
      return r ? toPlayer(r) : null;
    },
    async byIds(ids: string[]): Promise<Player[]> {
      if (!ids.length) return [];
      return (await db.select().from(s.players).where(inArray(s.players.id, ids))).map(toPlayer);
    },
    async byTeam(teamId: string): Promise<Player[]> {
      return (await db.select().from(s.players).where(eq(s.players.teamId, teamId))).map(toPlayer);
    },
    async latentAttributes(id: string) {
      const [r] = await db.select({ a: s.players.latentAttributes }).from(s.players).where(eq(s.players.id, id));
      return r?.a ?? null;
    },
    async upsertMany(rows: (Player & { latentAttributes?: Record<string, number> | null })[]) {
      await insertChunked(rows, 500, (chunk) =>
        db
          .insert(s.players)
          .values(chunk)
          .onConflictDoUpdate({ target: s.players.id, set: { name: sql`excluded.name`, teamId: sql`excluded.team_id` } }),
      );
    },
  };

  async function summarise(rows: MatchRow[]): Promise<MatchSummary[]> {
    if (!rows.length) return [];
    const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]))];
    const teamMap = new Map((await db.select().from(s.teams).where(inArray(s.teams.id, teamIds))).map((t) => [t.id, toTeam(t)]));
    const stats = await db
      .select({ matchId: s.teamMatchStats.matchId, teamId: s.teamMatchStats.teamId, xg: sql<number>`(${s.teamMatchStats.stats}->>'xg')::float` })
      .from(s.teamMatchStats)
      .where(inArray(s.teamMatchStats.matchId, rows.map((r) => r.id)));
    const xg = new Map(stats.map((x) => [`${x.matchId}:${x.teamId}`, x.xg]));
    return rows.map((r) => ({
      ...toMatch(r),
      homeTeam: teamMap.get(r.homeTeamId)!,
      awayTeam: teamMap.get(r.awayTeamId)!,
      homeXg: xg.get(`${r.id}:${r.homeTeamId}`) ?? null,
      awayXg: xg.get(`${r.id}:${r.awayTeamId}`) ?? null,
    }));
  }

  const matches = {
    async list(filter: { teamId?: string; limit?: number; status?: string } = {}): Promise<MatchSummary[]> {
      const where = and(
        filter.teamId ? sql`(${s.matches.homeTeamId} = ${filter.teamId} or ${s.matches.awayTeamId} = ${filter.teamId})` : undefined,
        filter.status ? eq(s.matches.status, filter.status) : undefined,
      );
      const rows = await db.select().from(s.matches).where(where).orderBy(desc(s.matches.kickoffAt)).limit(filter.limit ?? 100);
      return summarise(rows);
    },
    async get(id: string): Promise<Match | null> {
      const [r] = await db.select().from(s.matches).where(eq(s.matches.id, id));
      return r ? toMatch(r) : null;
    },
    async summary(id: string): Promise<MatchSummary | null> {
      const rows = await db.select().from(s.matches).where(eq(s.matches.id, id));
      return (await summarise(rows))[0] ?? null;
    },
    async keys(id: string) {
      const [r] = await db.select({ videoKey: s.matches.videoKey, trackingKey: s.matches.trackingKey }).from(s.matches).where(eq(s.matches.id, id));
      return r ?? null;
    },
    async create(m: Match & { videoKey?: string | null }) {
      await db.insert(s.matches).values({ ...m, kickoffAt: new Date(m.kickoffAt), videoKey: m.videoKey ?? null });
    },
    async update(id: string, patch: Partial<Omit<Match, 'id' | 'kickoffAt'>> & { videoKey?: string; trackingKey?: string }) {
      await db.update(s.matches).set(patch).where(eq(s.matches.id, id));
    },
    async countAnalysed(): Promise<number> {
      const [r] = await db.select({ n: count() }).from(s.matches).where(eq(s.matches.status, 'analysed'));
      return r?.n ?? 0;
    },
  };

  const lineups = {
    async replace(matchId: string, rows: Lineup[]) {
      await db.transaction(async (tx) => {
        await tx.delete(s.lineups).where(eq(s.lineups.matchId, matchId));
        if (rows.length) await tx.insert(s.lineups).values(rows);
      });
    },
    async byMatch(matchId: string) {
      const rows = await db
        .select({ l: s.lineups, p: s.players })
        .from(s.lineups)
        .innerJoin(s.players, eq(s.players.id, s.lineups.playerId))
        .where(eq(s.lineups.matchId, matchId));
      return rows.map((r) => ({ ...(r.l as Lineup), player: toPlayer(r.p) }));
    },
  };

  const eventsRepo = {
    async replace(matchId: string, rows: MatchEvent[]) {
      await db.transaction(async (tx) => {
        await tx.delete(s.events).where(eq(s.events.matchId, matchId));
        await insertChunked(rows, 2000, (chunk) => tx.insert(s.events).values(chunk));
      });
    },
    async byMatch(matchId: string, filter: { types?: string[]; playerId?: string } = {}): Promise<MatchEvent[]> {
      const rows = await db
        .select()
        .from(s.events)
        .where(
          and(
            eq(s.events.matchId, matchId),
            filter.types?.length ? inArray(s.events.type, filter.types) : undefined,
            filter.playerId ? eq(s.events.playerId, filter.playerId) : undefined,
          ),
        )
        .orderBy(s.events.period, s.events.t);
      return rows.map(toEvent);
    },
    /** Sample of successful moves + shots across all matches, used to fit xT. */
    async corpus(limit = 200_000): Promise<MatchEvent[]> {
      return (await db.select().from(s.events).limit(limit)).map(toEvent);
    },
    async count(): Promise<number> {
      const [r] = await db.select({ n: count() }).from(s.events);
      return r?.n ?? 0;
    },
  };

  const stats = {
    async replaceForMatch(matchId: string, playersStats: PlayerMatchStats[], teamStats: TeamMatchStats[]) {
      await db.transaction(async (tx) => {
        await tx.delete(s.playerMatchStats).where(eq(s.playerMatchStats.matchId, matchId));
        await tx.delete(s.teamMatchStats).where(eq(s.teamMatchStats.matchId, matchId));
        if (playersStats.length) await tx.insert(s.playerMatchStats).values(playersStats);
        if (teamStats.length)
          await tx.insert(s.teamMatchStats).values(teamStats.map((t) => ({ matchId, teamId: t.teamId, stats: t })));
      });
    },
    async playersByMatch(matchId: string): Promise<PlayerMatchStats[]> {
      return (await db.select().from(s.playerMatchStats).where(eq(s.playerMatchStats.matchId, matchId))) as PlayerMatchStats[];
    },
    async teamsByMatch(matchId: string): Promise<TeamMatchStats[]> {
      return (await db.select().from(s.teamMatchStats).where(eq(s.teamMatchStats.matchId, matchId))).map((r) => r.stats);
    },
    /** All match stats for a player, oldest first, joined with kickoff time. */
    async forPlayer(playerId: string) {
      const rows = await db
        .select({ st: s.playerMatchStats, kickoffAt: s.matches.kickoffAt })
        .from(s.playerMatchStats)
        .innerJoin(s.matches, eq(s.matches.id, s.playerMatchStats.matchId))
        .where(eq(s.playerMatchStats.playerId, playerId))
        .orderBy(s.matches.kickoffAt);
      return rows.map((r) => ({ ...(r.st as PlayerMatchStats), kickoffAt: r.kickoffAt.toISOString() }));
    },
  };

  const profiles = {
    async upsert(profile: PlayerProfile, embedding: number[]) {
      await db
        .insert(s.playerProfiles)
        .values({ playerId: profile.playerId, profile, embedding })
        .onConflictDoUpdate({ target: s.playerProfiles.playerId, set: { profile, embedding, updatedAt: new Date() } });
    },
    async get(playerId: string): Promise<PlayerProfile | null> {
      const [r] = await db.select().from(s.playerProfiles).where(eq(s.playerProfiles.playerId, playerId));
      return r?.profile ?? null;
    },
    async all(): Promise<PlayerProfile[]> {
      return (await db.select({ p: s.playerProfiles.profile }).from(s.playerProfiles)).map((r) => r.p);
    },
    /** Nearest neighbours by cosine distance on the style embedding (pgvector HNSW). */
    async similar(playerId: string, limit = 8) {
      const [me] = await db.select({ e: s.playerProfiles.embedding }).from(s.playerProfiles).where(eq(s.playerProfiles.playerId, playerId));
      if (!me) return [];
      const distance = cosineDistance(s.playerProfiles.embedding, me.e);
      const rows = await db
        .select({ p: s.players, teamName: s.teams.name, distance })
        .from(s.playerProfiles)
        .innerJoin(s.players, eq(s.players.id, s.playerProfiles.playerId))
        .innerJoin(s.teams, eq(s.teams.id, s.players.teamId))
        .where(ne(s.playerProfiles.playerId, playerId))
        .orderBy(distance)
        .limit(limit);
      return rows.map((r) => ({
        playerId: r.p.id,
        name: r.p.name,
        teamName: r.teamName,
        position: r.p.position as Player['position'],
        similarity: 1 - Number(r.distance),
      }));
    },
  };

  const jobs = {
    async create(job: { id: string; matchId: string; kind: ProcessingJob['kind']; stages: JobStage[] }): Promise<ProcessingJob> {
      const stages: StageState[] = job.stages.map((stage) => ({
        stage,
        status: 'queued',
        progress: 0,
        startedAt: null,
        finishedAt: null,
        message: null,
      }));
      const [r] = await db
        .insert(s.processingJobs)
        .values({ id: job.id, matchId: job.matchId, kind: job.kind, status: 'queued', stages })
        .returning();
      return toJob(r!);
    },
    async get(id: string): Promise<ProcessingJob | null> {
      const [r] = await db.select().from(s.processingJobs).where(eq(s.processingJobs.id, id));
      return r ? toJob(r) : null;
    },
    async latestForMatch(matchId: string): Promise<ProcessingJob | null> {
      const [r] = await db
        .select()
        .from(s.processingJobs)
        .where(eq(s.processingJobs.matchId, matchId))
        .orderBy(desc(s.processingJobs.createdAt))
        .limit(1);
      return r ? toJob(r) : null;
    },
    async active(): Promise<ProcessingJob[]> {
      const rows = await db
        .select()
        .from(s.processingJobs)
        .where(inArray(s.processingJobs.status, ['queued', 'running']))
        .orderBy(desc(s.processingJobs.createdAt))
        .limit(20);
      return rows.map(toJob);
    },
    /**
     * Update one stage atomically (row lock) and derive the overall job status:
     * failed if any stage failed, completed when all are, otherwise running.
     */
    async updateStage(
      jobId: string,
      stage: JobStage,
      patch: { status: JobStatus; progress?: number; message?: string | null },
    ): Promise<ProcessingJob | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(s.processingJobs).where(eq(s.processingJobs.id, jobId)).for('update');
        if (!row) return null;
        const now = new Date().toISOString();
        const stages = row.stages.map((st) => {
          if (st.stage !== stage) return st;
          return {
            ...st,
            status: patch.status,
            progress: patch.progress ?? (patch.status === 'completed' ? 1 : st.progress),
            message: patch.message === undefined ? st.message : patch.message,
            startedAt: st.startedAt ?? (patch.status !== 'queued' ? now : null),
            finishedAt: patch.status === 'completed' || patch.status === 'failed' ? now : null,
          };
        });
        const status: JobStatus = stages.some((x) => x.status === 'failed')
          ? 'failed'
          : stages.every((x) => x.status === 'completed')
            ? 'completed'
            : 'running';
        const [updated] = await tx
          .update(s.processingJobs)
          .set({
            stages,
            status,
            error: patch.status === 'failed' ? (patch.message ?? 'failed') : row.error,
            updatedAt: new Date(),
          })
          .where(eq(s.processingJobs.id, jobId))
          .returning();
        return toJob(updated!);
      });
    },
  };

  const reports = {
    async getMatchReport(matchId: string, teamId: string): Promise<StoredMatchReport | null> {
      const [r] = await db
        .select()
        .from(s.matchReports)
        .where(and(eq(s.matchReports.matchId, matchId), eq(s.matchReports.teamId, teamId)));
      return r ? { matchId: r.matchId, teamId: r.teamId, report: r.report, meta: r.meta } : null;
    },
    async saveMatchReport(matchId: string, teamId: string, report: MatchReport, meta: AiArtifactMeta) {
      await db
        .insert(s.matchReports)
        .values({ matchId, teamId, report, meta })
        .onConflictDoUpdate({ target: [s.matchReports.matchId, s.matchReports.teamId], set: { report, meta, createdAt: new Date() } });
    },
    async getPlayerEvaluation(playerId: string): Promise<StoredPlayerEvaluation | null> {
      const [r] = await db.select().from(s.playerEvaluations).where(eq(s.playerEvaluations.playerId, playerId));
      return r ? { playerId: r.playerId, evaluation: r.evaluation, meta: r.meta } : null;
    },
    async savePlayerEvaluation(playerId: string, evaluation: PlayerEvaluation, meta: AiArtifactMeta) {
      await db
        .insert(s.playerEvaluations)
        .values({ playerId, evaluation, meta })
        .onConflictDoUpdate({ target: s.playerEvaluations.playerId, set: { evaluation, meta, createdAt: new Date() } });
    },
  };

  const llmCalls = {
    async record(row: typeof s.llmCalls.$inferInsert) {
      await db.insert(s.llmCalls).values(row);
    },
  };

  const overview = {
    async topPerformers(limit = 5) {
      const rows = await db
        .select({ p: s.players, teamName: s.teams.name, profile: s.playerProfiles.profile })
        .from(s.playerProfiles)
        .innerJoin(s.players, eq(s.players.id, s.playerProfiles.playerId))
        .innerJoin(s.teams, eq(s.teams.id, s.players.teamId))
        .where(sql`(${s.playerProfiles.profile}->>'minutes')::float >= 180`)
        .orderBy(desc(sql`(${s.playerProfiles.profile}->>'avgRating')::float`))
        .limit(limit);
      return rows.map((r) => ({
        playerId: r.p.id,
        name: r.p.name,
        teamName: r.teamName,
        position: r.p.position,
        avgRating: r.profile.avgRating,
      }));
    },
    async counts() {
      const [[t], [p]] = await Promise.all([
        db.select({ n: count() }).from(s.teams),
        db.select({ n: count() }).from(s.players),
      ]);
      return { teams: t?.n ?? 0, players: p?.n ?? 0 };
    },
  };

  return { teams, players, matches, lineups, events: eventsRepo, stats, profiles, jobs, reports, llmCalls, overview };
}

export type Repositories = ReturnType<typeof createRepositories>;
