import type {
  MatchEvent,
  MatchSummary,
  Player,
  PlayerBenchmark,
  PlayerMatchStats,
  PlayerMetricKey,
  PlayerProfile,
  PlayerTrend,
  SimilarPlayer,
  Team,
  TeamMatchStats,
} from '@soccalytics/contracts';
import { PlayerMetricKey as MetricKeys } from '@soccalytics/contracts';

/**
 * Context builders turn engine output into the compact, rounded JSON the
 * model sees. Every number in a context is also registered as a "fact"
 * (subject + metric → value) so the grounding check can verify citations.
 */

export type Facts = Map<string, number>;
export const factKey = (subject: string, metric: string) => `${subject}::${metric}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BuiltContext<T> {
  context: T;
  facts: Facts;
  /** Valid ids for subjects (players/teams) mentioned in the context. */
  subjects: Set<string>;
}

export const TEAM_METRICS = [
  'goals',
  'xg',
  'shots',
  'possession_pct',
  'passes',
  'pass_accuracy',
  'ppda',
  'field_tilt',
  'progressive_passes',
  'pressures',
  'high_regains',
  'distance_km',
] as const;

function teamMetricValues(s: TeamMatchStats): Record<(typeof TEAM_METRICS)[number], number> {
  return {
    goals: s.goals,
    xg: s.xg,
    shots: s.shots,
    possession_pct: s.possessionPct,
    passes: s.passes,
    pass_accuracy: s.passAccuracy,
    ppda: s.ppda,
    field_tilt: s.fieldTilt,
    progressive_passes: s.progressivePasses,
    pressures: s.pressures,
    high_regains: s.highRegains,
    distance_km: s.distanceKm,
  };
}

export interface MatchContextInput {
  match: MatchSummary;
  focusTeamId: string;
  teamStats: TeamMatchStats[];
  playerStats: PlayerMatchStats[];
  players: Player[];
  shots: MatchEvent[];
}

export function buildMatchContext(input: MatchContextInput) {
  const facts: Facts = new Map();
  const subjects = new Set<string>();
  const names = new Map(input.players.map((p) => [p.id, p]));
  const teamName = (id: string) =>
    id === input.match.homeTeam.id ? input.match.homeTeam.name : input.match.awayTeam.name;

  const teams = input.teamStats.map((s) => {
    subjects.add(s.teamId);
    const metrics = Object.fromEntries(
      Object.entries(teamMetricValues(s)).map(([k, v]) => {
        facts.set(factKey(s.teamId, k), r2(v));
        return [k, r2(v)];
      }),
    );
    return {
      teamId: s.teamId,
      name: teamName(s.teamId),
      side: s.teamId === input.match.homeTeamId ? 'home' : 'away',
      isFocusTeam: s.teamId === input.focusTeamId,
      metrics,
    };
  });

  const players = [...input.playerStats]
    .sort((a, b) => b.rating - a.rating)
    .map((s) => {
      subjects.add(s.playerId);
      const p = names.get(s.playerId);
      // Only send non-zero metrics: smaller context, and zeros are rarely insightful.
      const metrics: Record<string, number> = { rating: r2(s.rating) };
      facts.set(factKey(s.playerId, 'rating'), r2(s.rating));
      for (const k of MetricKeys.options) {
        const v = s.metrics[k];
        if (v) {
          metrics[k] = r2(v);
          facts.set(factKey(s.playerId, k), r2(v));
        }
      }
      return {
        playerId: s.playerId,
        name: p?.name ?? s.playerId,
        shirtNumber: p?.shirtNumber ?? null,
        teamId: s.teamId,
        position: s.position,
        metrics,
      };
    });

  const shots = input.shots
    .filter((e) => e.type === 'shot')
    .map((e) => ({
      minute: Math.floor(e.t / 60) + (e.period === 2 ? 45 : 0),
      playerId: e.playerId,
      teamId: e.teamId,
      xg: r2(e.xg ?? 0),
      goal: e.success,
      pattern: e.playPattern,
    }))
    .sort((a, b) => a.minute - b.minute);

  const context = {
    match: {
      matchId: input.match.id,
      competition: input.match.competition,
      kickoffAt: input.match.kickoffAt,
      score: `${input.match.homeTeam.name} ${input.match.homeScore ?? 0}–${input.match.awayScore ?? 0} ${input.match.awayTeam.name}`,
      focusTeamId: input.focusTeamId,
      focusTeamName: teamName(input.focusTeamId),
    },
    teams,
    players,
    shots,
  };
  return { context, facts, subjects } satisfies BuiltContext<typeof context>;
}

export interface PlayerContextInput {
  player: Player;
  team: Team;
  age: number;
  profile: PlayerProfile;
  benchmark: PlayerBenchmark;
  trend: PlayerTrend;
  similar: SimilarPlayer[];
}

export function buildPlayerContext(input: PlayerContextInput) {
  const facts: Facts = new Map();
  const subjects = new Set<string>([input.player.id]);
  const id = input.player.id;
  const set = (metric: string, value: number) => {
    facts.set(factKey(id, metric), r2(value));
    return r2(value);
  };

  const per90: Record<string, number> = {};
  for (const k of MetricKeys.options) per90[k] = set(k, input.profile.per90[k]);

  const benchmark = input.benchmark.metrics.map((m) => ({
    metric: m.metric,
    per90: r2(m.value),
    cohortMedian: r2(m.cohortMedian),
    percentile: set(`${m.metric}_percentile`, m.percentile),
  }));

  const context = {
    player: {
      playerId: id,
      name: input.player.name,
      age: input.age,
      position: input.player.position,
      foot: input.player.foot,
      heightCm: input.player.heightCm,
      team: input.team.name,
      teamLevel: input.team.level,
    },
    sample: {
      matches: set('matches', input.profile.matches),
      minutes: set('minutes', input.profile.minutes),
      avg_rating: set('avg_rating', input.profile.avgRating),
    },
    per90,
    benchmark: {
      cohort: input.benchmark.cohort,
      cohortSize: input.benchmark.cohortSize,
      metrics: benchmark,
      strengths: input.benchmark.strengths,
      weaknesses: input.benchmark.weaknesses,
    },
    trend: {
      rating_slope: set('rating_slope', input.trend.ratingSlope),
      projection: {
        horizonMatches: input.trend.projection.horizonMatches,
        projected_rating: set('projected_rating', input.trend.projection.rating),
        low: r2(input.trend.projection.low),
        high: r2(input.trend.projection.high),
      },
    },
    similarPlayers: input.similar.map((s) => ({ name: s.name, team: s.teamName, position: s.position, similarity: r2(s.similarity) })),
  };
  return { context, facts, subjects } satisfies BuiltContext<typeof context>;
}

export type MatchContext = ReturnType<typeof buildMatchContext>['context'];
export type PlayerContext = ReturnType<typeof buildPlayerContext>['context'];
export type { PlayerMetricKey };
