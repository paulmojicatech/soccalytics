import {
  aggregateProfile,
  computeMatchStats,
  enrichEvents,
  fitXtGrid,
  inferEventsFromTracking,
  priorXtGrid,
  profileVector,
  type XtGrid,
} from '@soccalytics/analytics';
import { generateMatchReport, type Gateway } from '@soccalytics/ai';
import type { Repositories } from '@soccalytics/db';
import type { Storage } from '@soccalytics/platform';
import { simulateMatch, type LatentAttributes, type SimPlayer } from '@soccalytics/simulator';
import type {
  JobStage,
  JobStatus,
  Lineup,
  MatchEventInput,
  Player,
  Position,
  TrackingDocument,
} from '@soccalytics/contracts';
import { PITCH } from '@soccalytics/contracts';

export type ReportStage = (stage: JobStage, status: JobStatus, progress?: number, message?: string) => Promise<void>;

export interface PipelineDeps {
  repos: Repositories;
  storage: Storage;
  ai: Gateway;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

const trackingKey = (matchId: string) => `tracking/${matchId}.json.gz`;
const XT_MIN_EVENTS = 20_000;
const XT_TTL_MS = 10 * 60_000;

/**
 * Pipeline stages as plain async functions, shared by the BullMQ worker and
 * the seed script. Each stage is idempotent: it replaces its own outputs.
 */
export function createPipeline({ repos, storage, ai, log }: PipelineDeps) {
  let xt: { grid: XtGrid; at: number } | null = null;

  /** xT is fitted on the whole event corpus (Karun Singh value iteration), cached. */
  async function xtGrid(): Promise<XtGrid> {
    if (xt && Date.now() - xt.at < XT_TTL_MS) return xt.grid;
    const corpus = await repos.events.corpus();
    const grid = corpus.length >= XT_MIN_EVENTS ? fitXtGrid(corpus) : priorXtGrid();
    log('xT grid ready', { events: corpus.length, fitted: corpus.length >= XT_MIN_EVENTS });
    xt = { grid, at: Date.now() };
    return grid;
  }

  async function persistEvents(matchId: string, events: MatchEventInput[]) {
    const enriched = enrichEvents(events, await xtGrid());
    await repos.events.replace(matchId, enriched);
    return enriched;
  }

  /** Demo path: synthesise tracking + events for a fixture. */
  async function simulate(matchId: string, seed: number, report: ReportStage) {
    await report('events', 'running', 0.05, 'Simulating match');
    const match = await repos.matches.get(matchId);
    if (!match) throw new Error(`match ${matchId} missing`);
    const side = async (teamId: string) => {
      const [team, players] = await Promise.all([repos.teams.get(teamId), repos.players.byTeam(teamId)]);
      const withAttrs = await Promise.all(
        players.map(async (p): Promise<SimPlayer> => ({ ...p, attributes: (await repos.players.latentAttributes(p.id)) as unknown as LatentAttributes })),
      );
      return { team: team!, players: withAttrs };
    };
    const [home, away] = await Promise.all([side(match.homeTeamId), side(match.awayTeamId)]);
    const sim = simulateMatch({ matchId, seed, home, away });

    await report('events', 'running', 0.5, 'Storing tracking data');
    await storage.putJsonGz(trackingKey(matchId), sim.tracking);
    await repos.matches.update(matchId, {
      trackingKey: trackingKey(matchId),
      durationSec: sim.durationSec,
      homeScore: sim.homeScore,
      awayScore: sim.awayScore,
    });
    await repos.lineups.replace(matchId, sim.lineups);
    const events = await persistEvents(matchId, sim.events);
    await report('events', 'completed', 1, `${events.length} events detected`);
  }

  /** CV path: infer on-ball events from tracking produced by the vision worker. */
  async function eventsFromTracking(matchId: string, key: string, report: ReportStage) {
    await report('events', 'running', 0.05, 'Loading tracking data');
    const match = await repos.matches.get(matchId);
    if (!match) throw new Error(`match ${matchId} missing`);
    const doc = await storage.getJsonGz<TrackingDocument>(key);
    await repos.matches.update(matchId, { trackingKey: key });

    await report('events', 'running', 0.3, 'Registering tracked players');
    const lineups = await registerTrackedPlayers(doc);
    await repos.lineups.replace(matchId, lineups);

    await report('events', 'running', 0.5, 'Inferring on-ball events');
    const events = await persistEvents(matchId, inferEventsFromTracking(doc));
    const goals = (teamId: string) => events.filter((e) => e.type === 'shot' && e.success && e.teamId === teamId).length;
    const last = doc.frames.at(-1);
    await repos.matches.update(matchId, {
      homeScore: goals(match.homeTeamId),
      awayScore: goals(match.awayTeamId),
      durationSec: last ? Math.round(last.t + (last.period - 1) * 45 * 60) : null,
    });
    await report('events', 'completed', 1, `${events.length} events detected`);
  }

  /**
   * Tracks from CV have no identity yet (jersey OCR is a TODO in the vision
   * worker), so each track becomes a provisional player with a role guessed
   * from its average position in the attacking-normalised frame.
   */
  async function registerTrackedPlayers(doc: TrackingDocument): Promise<Lineup[]> {
    const acc = new Map<string, { teamId: string; sumX: number; sumY: number; n: number }>();
    for (const f of doc.frames) {
      for (const p of f.players) {
        const homeRight = doc.meta.homeAttacksRight[f.period - 1] ?? true;
        const attacksRight = p.teamId === doc.meta.homeTeamId ? homeRight : !homeRight;
        const x = attacksRight ? p.x : PITCH.length - p.x;
        const a = acc.get(p.playerId) ?? { teamId: p.teamId, sumX: 0, sumY: 0, n: 0 };
        a.sumX += x;
        a.sumY += p.y;
        a.n++;
        acc.set(p.playerId, a);
      }
    }
    const existing = new Set((await repos.players.byIds([...acc.keys()])).map((p) => p.id));
    const fresh: Player[] = [];
    const lineups: Lineup[] = [];
    let n = 0;
    for (const [playerId, a] of acc) {
      const position = guessPosition(a.sumX / a.n, a.sumY / a.n);
      if (!existing.has(playerId)) {
        n++;
        fresh.push({
          id: playerId,
          teamId: a.teamId,
          name: `Tracked player ${playerId.split('-').pop()}`,
          shirtNumber: 100 + n,
          position,
          birthDate: '2000-01-01',
          heightCm: null,
          foot: 'right',
          nationality: null,
        });
      }
      lineups.push({
        matchId: doc.meta.matchId,
        teamId: a.teamId,
        playerId,
        starter: true,
        minutesPlayed: Math.round((a.n / doc.meta.fps / 60) * 10) / 10,
        position,
      });
    }
    if (fresh.length) await repos.players.upsertMany(fresh);
    return lineups;
  }

  async function metrics(matchId: string, report: ReportStage) {
    await report('metrics', 'running', 0.1, 'Computing match metrics');
    const match = await repos.matches.get(matchId);
    const keys = await repos.matches.keys(matchId);
    if (!match) throw new Error(`match ${matchId} missing`);
    const [lineups, events, tracking] = await Promise.all([
      repos.lineups.byMatch(matchId),
      repos.events.byMatch(matchId),
      keys?.trackingKey ? storage.getJsonGz<TrackingDocument>(keys.trackingKey) : Promise.resolve(null),
    ]);
    const result = computeMatchStats({ match, lineups: lineups.map(({ player: _p, ...l }) => l), events, tracking });
    await repos.stats.replaceForMatch(matchId, result.players, result.teams);

    await report('metrics', 'running', 0.7, 'Updating player profiles');
    for (const l of lineups) {
      const history = await repos.stats.forPlayer(l.playerId);
      if (!history.length) continue;
      const profile = aggregateProfile(l.playerId, l.player.position, history);
      await repos.profiles.upsert(profile, profileVector(profile));
    }
    await repos.matches.update(matchId, { status: 'analysed' });
    await report('metrics', 'completed', 1, `${result.players.length} player profiles updated`);
  }

  async function reports(matchId: string, report: ReportStage, enabled: boolean) {
    if (!enabled) {
      await report('report', 'completed', 1, 'Skipped (AUTO_REPORTS=false)');
      return;
    }
    await report('report', 'running', 0.1, ai.online ? 'Generating AI match reports' : 'Generating offline reports');
    const match = await repos.matches.summary(matchId);
    if (!match) throw new Error(`match ${matchId} missing`);
    const [teamStats, playerStats, lineups, shots] = await Promise.all([
      repos.stats.teamsByMatch(matchId),
      repos.stats.playersByMatch(matchId),
      repos.lineups.byMatch(matchId),
      repos.events.byMatch(matchId, { types: ['shot'] }),
    ]);
    const players = lineups.map((l) => l.player);
    await Promise.all(
      [match.homeTeamId, match.awayTeamId].map(async (teamId) => {
        const { report: r, meta } = await generateMatchReport(ai, { match, focusTeamId: teamId, teamStats, playerStats, players, shots });
        await repos.reports.saveMatchReport(matchId, teamId, r, meta);
      }),
    );
    await report('report', 'completed', 1, 'Reports ready');
  }

  return { simulate, eventsFromTracking, metrics, reports };
}
export type Pipeline = ReturnType<typeof createPipeline>;

function guessPosition(x: number, y: number): Position {
  const central = Math.abs(y - PITCH.width / 2) < 14;
  if (x < 12) return 'GK';
  if (x < 32) return central ? 'CB' : 'FB';
  if (x < 45) return central ? 'DM' : 'FB';
  if (x < 60) return central ? 'CM' : 'W';
  if (x < 72) return central ? 'AM' : 'W';
  return central ? 'ST' : 'W';
}
