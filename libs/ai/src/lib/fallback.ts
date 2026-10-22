import {
  METRIC_META,
  type GroundedClaim,
  type MatchReport,
  type PlayerEvaluation,
  type PlayerMetricKey,
  type Position,
  type ScoutFilter,
} from '@soccalytics/contracts';
import type { MatchContext, PlayerContext } from './context.js';

/*
 * Deterministic, template-based fallbacks used when no API key is configured
 * (or the model is unavailable). They follow the same schemas and cite the
 * same facts, so the UI, grounding checks and evals work identically offline.
 */

const claim = (text: string, subject: string, metric: string, value: number): GroundedClaim => ({
  text,
  evidence: [{ subject, metric, value }],
});

export function fallbackMatchReport(ctx: MatchContext): MatchReport {
  const focus = ctx.teams.find((t) => t.isFocusTeam) ?? ctx.teams[0]!;
  const opp = ctx.teams.find((t) => t !== focus) ?? focus;
  const fm = focus.metrics as Record<string, number>;
  const om = opp.metrics as Record<string, number>;
  const focusPlayers = ctx.players.filter((p) => p.teamId === focus.teamId);
  const top = ctx.players.slice(0, 3);
  const xgDiff = (fm['xg'] ?? 0) - (om['xg'] ?? 0);
  const goalsDiff = (fm['goals'] ?? 0) - (om['goals'] ?? 0);

  const finishing =
    Math.sign(goalsDiff) !== Math.sign(xgDiff) && Math.abs(xgDiff) > 0.4
      ? ` The result ran against the chance quality (${fm['xg']} xG vs ${om['xg']}), pointing to finishing variance.`
      : '';

  const pressing =
    (fm['ppda'] ?? 99) < (om['ppda'] ?? 99)
      ? claim(`${focus.name} pressed more aggressively (PPDA ${fm['ppda']} vs ${om['ppda']}).`, focus.teamId, 'ppda', fm['ppda']!)
      : claim(`${focus.name} allowed the opponent time on the ball (PPDA ${fm['ppda']}).`, focus.teamId, 'ppda', fm['ppda']!);

  const lowest = [...focusPlayers].sort((a, b) => a.metrics['rating']! - b.metrics['rating']!)[0];

  return {
    headline: `${ctx.match.score}: ${xgDiff >= 0 ? 'chance quality favoured' : 'out-created by the opponent,'} ${focus.name}`,
    summary: `${ctx.match.score} in the ${ctx.match.competition}. ${focus.name} generated ${fm['xg']} xG from ${fm['shots']} shots against ${om['xg']} from ${om['shots']}, with ${fm['possession_pct']}% possession.${finishing} This report was generated offline from templates; connect the Claude API for full tactical narration.`,
    tacticalBreakdown: {
      inPossession: [
        claim(`Possession share of ${fm['possession_pct']}% with ${fm['pass_accuracy']}% pass accuracy.`, focus.teamId, 'possession_pct', fm['possession_pct']!),
        claim(`${fm['progressive_passes']} progressive passes moved the ball forward.`, focus.teamId, 'progressive_passes', fm['progressive_passes']!),
      ],
      outOfPossession: [pressing, claim(`${fm['high_regains']} high regains in the attacking third.`, focus.teamId, 'high_regains', fm['high_regains']!)],
      transitions: [claim(`Field tilt of ${fm['field_tilt']}% describes territorial control.`, focus.teamId, 'field_tilt', fm['field_tilt']!)],
    },
    standoutPlayers: top.map((p) => ({
      playerId: p.playerId,
      reason: claim(`${p.name} posted a match rating of ${p.metrics['rating']}.`, p.playerId, 'rating', p.metrics['rating']!),
    })),
    concerns: lowest
      ? [claim(`${lowest.name} had the lowest rating in the side (${lowest.metrics['rating']}).`, lowest.playerId, 'rating', lowest.metrics['rating']!)]
      : [],
    trainingFocus: [
      { theme: 'Pressing triggers', drill: '6v6+3 rondo with transition to counter-press within 5 seconds', rationale: `PPDA was ${fm['ppda']}.` },
      { theme: 'Chance creation', drill: 'Final-third overload game (5v4) finishing in the box', rationale: `${fm['shots']} shots for ${fm['xg']} xG.` },
    ],
  };
}

export function fallbackPlayerEvaluation(ctx: PlayerContext): PlayerEvaluation {
  const id = ctx.player.playerId;
  const byKey = new Map(ctx.benchmark.metrics.map((m) => [m.metric, m]));
  const toClaim = (k: PlayerMetricKey, kind: 'strength' | 'gap') => {
    const m = byKey.get(k)!;
    const label = METRIC_META[k].label;
    return claim(
      kind === 'strength'
        ? `${label}: ${m.per90} per 90, ${m.percentile}th percentile among ${ctx.benchmark.cohort.replace('_', ' ')}.`
        : `${label} is a development area at the ${m.percentile}th percentile.`,
      id,
      `${k}_percentile`,
      m.percentile,
    );
  };
  const strengths = ctx.benchmark.strengths.filter((k) => byKey.has(k)).map((k) => toClaim(k, 'strength'));
  const gaps = ctx.benchmark.weaknesses.filter((k) => byKey.has(k)).map((k) => toClaim(k, 'gap'));
  const avgPct = ctx.benchmark.metrics.reduce((a, m) => a + m.percentile, 0) / Math.max(ctx.benchmark.metrics.length, 1);
  const verdict: PlayerEvaluation['scoutingVerdict'] =
    avgPct > 70 && ctx.trend.rating_slope > 0 ? 'priority_target' : avgPct > 60 ? 'shortlist' : avgPct > 40 ? 'monitor' : 'not_a_fit';

  return {
    summary: `${ctx.player.name} (${ctx.player.age}, ${ctx.player.position}, ${ctx.player.team}) averages a ${ctx.sample.avg_rating} rating over ${ctx.sample.matches} matches. Generated offline from templates.`,
    strengths,
    developmentAreas: gaps,
    playerComparison: ctx.similarPlayers[0]
      ? `Statistically closest to ${ctx.similarPlayers.slice(0, 2).map((s) => s.name).join(' and ')}.`
      : '',
    developmentPlan: ctx.benchmark.weaknesses.slice(0, 2).map((k) => ({
      goal: `Improve ${METRIC_META[k].label.toLowerCase()}`,
      kpi: `${k} per 90 above the cohort median (${byKey.get(k)?.cohortMedian ?? '—'})`,
      timeframeWeeks: 8,
    })),
    scoutingVerdict: verdict,
  };
}

const POSITION_WORDS: [RegExp, Position[]][] = [
  [/goal ?keeper|keeper|\bgk\b/i, ['GK']],
  [/centre[- ]?backs?|center[- ]?backs?|\bcbs?\b/i, ['CB']],
  [/full[- ]?backs?|wing[- ]?backs?|\bfbs?\b/i, ['FB']],
  [/defensive mid|holding mid|\bdm\b|\bcdm\b/i, ['DM']],
  [/central mid|\bcm\b|midfielders?/i, ['CM']],
  [/attacking mid|\bam\b|number 10|\bcam\b/i, ['AM']],
  [/wingers?|wide/i, ['W']],
  [/strikers?|forwards?|\bst\b|number 9|centre[- ]forward/i, ['ST']],
];

const QUALITY_WORDS: [RegExp, PlayerMetricKey[]][] = [
  [/progress|carr(y|ies)|break lines/i, ['progressive_passes', 'progressive_carries', 'xt_added']],
  [/press|work ?rate|intens/i, ['pressures', 'pressure_regains']],
  [/goal|clinical|finish|xg/i, ['xg', 'goals', 'shots_on_target']],
  [/creat|chance|assist|playmak/i, ['key_passes', 'xa', 'xt_added']],
  [/pace|quick|fast|sprint|rapid/i, ['top_speed_kmh', 'sprint_count']],
  [/engine|stamina|covers? ground|running/i, ['distance_km', 'hsr_distance_m']],
  [/tackl|ball[- ]?win|intercept|defend/i, ['tackles_won', 'interceptions', 'recoveries']],
  [/dribbl|1v1|take on/i, ['dribbles_completed']],
  [/pass(ing|er)|distribut/i, ['pass_accuracy', 'passes']],
];

/** Keyword-based compiler used when the LLM is unavailable. */
export function fallbackScoutFilter(query: string): ScoutFilter {
  const positions = [...new Set(POSITION_WORDS.filter(([re]) => re.test(query)).flatMap(([, p]) => p))];
  const rankBy = [...new Set(QUALITY_WORDS.filter(([re]) => re.test(query)).flatMap(([, m]) => m))].slice(0, 5);
  const under = /(?:under|u)[- ]?(\d{2})/i.exec(query);
  const elite = /elite|top|best|must/i.test(query);
  return {
    positions,
    maxAge: under ? Number(under[1]) - 1 : /young/i.test(query) ? 21 : null,
    minAge: null,
    minMinutes: 90,
    foot: /left[- ]?foot/i.test(query) ? 'left' : /right[- ]?foot/i.test(query) ? 'right' : null,
    metricThresholds: elite && rankBy[0] ? [{ metric: rankBy[0], minPercentile: 80 }] : [],
    rankBy: rankBy.length ? rankBy : ['xt_added', 'progressive_passes'],
    similarToPlayerName: /similar to|like ([A-Z][a-z]+ [A-Z][a-z]+)/.exec(query)?.[1] ?? null,
    interpretation: `Keyword match (offline mode): ${query}`,
  };
}
