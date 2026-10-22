import {
  benchmarkPlayer,
  cosineSimilarity,
  playerTrend,
  profileVector,
  rankScoutCandidates,
  type ScoutCandidate,
} from '@soccalytics/analytics';
import {
  compileScoutQuery,
  generateMatchReport,
  generatePlayerEvaluation,
  type AnalystTools,
  type Gateway,
} from '@soccalytics/ai';
import { ageOn, type Repositories } from '@soccalytics/db';
import type {
  BenchmarkCohort,
  PlayerBenchmark,
  PlayerProfile,
  PlayerTrend,
  ScoutSearchResponse,
} from '@soccalytics/contracts';

const MIN_COHORT_MINUTES = 180;

export class NotFoundError extends Error {
  readonly statusCode = 404;
}

/**
 * Read-side domain service: combines repositories with the deterministic
 * analytics engine, and feeds grounded context to the AI tasks.
 */
export function createInsights(repos: Repositories, ai: Gateway) {
  async function profileOrThrow(playerId: string): Promise<PlayerProfile> {
    const profile = await repos.profiles.get(playerId);
    if (!profile) throw new NotFoundError(`No analysed matches for player ${playerId}`);
    return profile;
  }

  async function cohort(playerId: string, kind: BenchmarkCohort): Promise<PlayerProfile[]> {
    const [player, profiles, players, teams] = await Promise.all([
      repos.players.get(playerId),
      repos.profiles.all(),
      repos.players.list(),
      repos.teams.list(),
    ]);
    if (!player) throw new NotFoundError(`Player ${playerId} not found`);
    const teamOf = new Map(players.map((p) => [p.id, p.teamId]));
    const levelOf = new Map(teams.map((t) => [t.id, t.level]));
    const eligible = profiles.filter((p) => p.minutes >= MIN_COHORT_MINUTES || p.playerId === playerId);
    switch (kind) {
      case 'team':
        return eligible.filter((p) => teamOf.get(p.playerId) === player.teamId);
      case 'pro_reference':
        return eligible.filter((p) => p.position === player.position && levelOf.get(teamOf.get(p.playerId) ?? '') === 'pro');
      default:
        return eligible.filter((p) => p.position === player.position);
    }
  }

  async function benchmark(playerId: string, kind: BenchmarkCohort): Promise<PlayerBenchmark> {
    const profile = await profileOrThrow(playerId);
    return benchmarkPlayer(profile, await cohort(playerId, kind), kind);
  }

  async function trend(playerId: string): Promise<PlayerTrend> {
    const stats = await repos.stats.forPlayer(playerId);
    return playerTrend(
      playerId,
      stats.map((s) => ({ matchId: s.matchId, kickoffAt: s.kickoffAt, rating: s.rating, metrics: s.metrics })),
    );
  }

  async function playerDetail(playerId: string) {
    const player = await repos.players.get(playerId);
    if (!player) throw new NotFoundError(`Player ${playerId} not found`);
    const [team, profile, stats] = await Promise.all([
      repos.teams.get(player.teamId),
      repos.profiles.get(playerId),
      repos.stats.forPlayer(playerId),
    ]);
    const recent = stats.slice(-8).reverse();
    const summaries = await Promise.all(recent.map((s) => repos.matches.summary(s.matchId)));
    return {
      player,
      team: team!,
      age: ageOn(player.birthDate),
      profile,
      recentMatches: recent.flatMap((s, i) => {
        const { kickoffAt: _k, ...stat } = s;
        return summaries[i] ? [{ ...stat, match: summaries[i]! }] : [];
      }),
    };
  }

  async function scoutSearch(query: string, limit = 15): Promise<ScoutSearchResponse> {
    const filter = await compileScoutQuery(ai, query);
    const [players, profiles] = await Promise.all([repos.players.list(), repos.profiles.all()]);
    const profileOf = new Map(profiles.map((p) => [p.playerId, p]));

    // Percentiles vs position peers, computed per position once.
    const byPosition = new Map<string, PlayerProfile[]>();
    for (const p of profiles) {
      if (p.minutes < MIN_COHORT_MINUTES) continue;
      byPosition.set(p.position, [...(byPosition.get(p.position) ?? []), p]);
    }

    let reference: number[] | null = null;
    if (filter.similarToPlayerName) {
      const ref = players.find((p) => p.name.toLowerCase().includes(filter.similarToPlayerName!.toLowerCase()));
      const refProfile = ref && profileOf.get(ref.id);
      if (refProfile) reference = profileVector(refProfile);
    }

    const candidates: ScoutCandidate[] = players.flatMap((p) => {
      const profile = profileOf.get(p.id);
      if (!profile) return [];
      const bench = benchmarkPlayer(profile, byPosition.get(p.position) ?? [profile], 'position_peers');
      return [
        {
          player: p,
          teamName: p.teamName,
          age: p.age,
          profile,
          percentiles: Object.fromEntries(bench.metrics.map((m) => [m.metric, m.percentile])),
          similarity: reference ? cosineSimilarity(reference, profileVector(profile)) : undefined,
        },
      ];
    });
    return { filter, results: rankScoutCandidates(filter, candidates).slice(0, limit) };
  }

  async function matchReport(matchId: string, teamId: string) {
    const match = await repos.matches.summary(matchId);
    if (!match) throw new NotFoundError(`Match ${matchId} not found`);
    if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) throw new NotFoundError(`Team ${teamId} did not play in this match`);
    const [teamStats, playerStats, lineups, shots] = await Promise.all([
      repos.stats.teamsByMatch(matchId),
      repos.stats.playersByMatch(matchId),
      repos.lineups.byMatch(matchId),
      repos.events.byMatch(matchId, { types: ['shot'] }),
    ]);
    if (!teamStats.length) throw new NotFoundError('Match has not been analysed yet');
    const { report, meta } = await generateMatchReport(ai, {
      match,
      focusTeamId: teamId,
      teamStats,
      playerStats,
      players: lineups.map((l) => l.player),
      shots,
    });
    await repos.reports.saveMatchReport(matchId, teamId, report, meta);
    return { matchId, teamId, report, meta };
  }

  async function playerEvaluation(playerId: string) {
    const detail = await playerDetail(playerId);
    if (!detail.profile) throw new NotFoundError('Player has no analysed matches yet');
    const [bench, tr, similar] = await Promise.all([
      benchmark(playerId, 'position_peers'),
      trend(playerId),
      repos.profiles.similar(playerId, 3),
    ]);
    const { evaluation, meta } = await generatePlayerEvaluation(ai, {
      player: detail.player,
      team: detail.team,
      age: detail.age,
      profile: detail.profile,
      benchmark: bench,
      trend: tr,
      similar,
    });
    await repos.reports.savePlayerEvaluation(playerId, evaluation, meta);
    return { playerId, evaluation, meta };
  }

  /** Read-only tool handlers for the analyst assistant. Results stay compact. */
  const assistantTools: AnalystTools = {
    async searchPlayers({ name, position, teamName, limit }) {
      const rows = await repos.players.list({ q: name, position });
      return rows
        .filter((r) => !teamName || r.teamName.toLowerCase().includes(teamName.toLowerCase()))
        .slice(0, limit)
        .map((r) => ({ playerId: r.id, name: r.name, team: r.teamName, position: r.position, age: r.age, minutes: Math.round(r.minutes), avgRating: r.avgRating }));
    },
    async getPlayer({ playerId }) {
      const detail = await playerDetail(playerId);
      if (!detail.profile) return { player: detail.player, note: 'No analysed matches yet' };
      const [bench, tr, similar] = await Promise.all([benchmark(playerId, 'position_peers'), trend(playerId), repos.profiles.similar(playerId, 3)]);
      return {
        player: { ...detail.player, team: detail.team.name, age: detail.age },
        sample: { matches: detail.profile.matches, minutes: Math.round(detail.profile.minutes), avgRating: detail.profile.avgRating },
        percentilesVsPositionPeers: Object.fromEntries(bench.metrics.map((m) => [m.metric, { per90: round(m.value), percentile: Math.round(m.percentile) }])),
        strengths: bench.strengths,
        weaknesses: bench.weaknesses,
        trend: { ratingSlopePerMatch: round(tr.ratingSlope), projection: tr.projection },
        similarPlayers: similar.map((s) => ({ name: s.name, team: s.teamName, similarity: round(s.similarity) })),
      };
    },
    async comparePlayers({ playerIds }) {
      return Promise.all(
        playerIds.map(async (id) => {
          const [p, profile] = await Promise.all([repos.players.get(id), repos.profiles.get(id)]);
          return { playerId: id, name: p?.name, position: p?.position, minutes: profile?.minutes, per90: profile ? mapValues(profile.per90, round) : null };
        }),
      );
    },
    async listMatches({ teamName, limit }) {
      const teams = teamName ? (await repos.teams.list()).filter((t) => t.name.toLowerCase().includes(teamName.toLowerCase())) : [];
      const rows = await repos.matches.list({ teamId: teams[0]?.id, limit });
      return rows.map((m) => ({
        matchId: m.id,
        date: m.kickoffAt.slice(0, 10),
        fixture: `${m.homeTeam.name} ${m.homeScore ?? '-'}–${m.awayScore ?? '-'} ${m.awayTeam.name}`,
        xg: `${round(m.homeXg ?? 0)}–${round(m.awayXg ?? 0)}`,
        status: m.status,
      }));
    },
    async getMatch({ matchId }) {
      const [match, teams, players, lineups] = await Promise.all([
        repos.matches.summary(matchId),
        repos.stats.teamsByMatch(matchId),
        repos.stats.playersByMatch(matchId),
        repos.lineups.byMatch(matchId),
      ]);
      if (!match) return { error: 'Match not found' };
      const name = new Map(lineups.map((l) => [l.playerId, l.player.name]));
      return {
        fixture: `${match.homeTeam.name} ${match.homeScore}–${match.awayScore} ${match.awayTeam.name}`,
        teams: teams.map(({ passingNetwork: _n, xgTimeline: _t, ...t }) => ({ ...t, team: t.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name })),
        topPlayers: [...players]
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 6)
          .map((p) => ({ playerId: p.playerId, name: name.get(p.playerId), rating: round(p.rating), xg: round(p.metrics.xg), xa: round(p.metrics.xa), progressivePasses: p.metrics.progressive_passes })),
      };
    },
    async scoutSearch({ query }) {
      const { filter, results } = await scoutSearch(query, 8);
      return { interpretation: filter.interpretation, results: results.map((r) => ({ playerId: r.playerId, name: r.name, team: r.teamName, position: r.position, age: r.age, score: round(r.score) })) };
    },
  };

  return { benchmark, trend, playerDetail, scoutSearch, matchReport, playerEvaluation, assistantTools };
}
export type Insights = ReturnType<typeof createInsights>;

const round = (n: number) => Math.round(n * 100) / 100;
const mapValues = <T extends Record<string, number>>(o: T, f: (n: number) => number) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
