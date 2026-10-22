import { METRIC_META, PlayerMetricKey } from '@soccalytics/contracts';
import { TEAM_METRICS } from '../context.js';

const DEFINITIONS: Partial<Record<string, string>> = {
  xg: 'Expected goals: probability a shot becomes a goal, from shot distance, angle, body part and situation. Summed over shots.',
  xa: "Expected assists: xG of shots taken directly from the player's passes.",
  xt_added: 'Expected threat added: increase in the probability of scoring within the next few actions created by successful passes and carries (Karun Singh xT model).',
  progressive_passes: 'Completed passes moving the ball substantially closer to goal (≥30 m in own half, ≥15 m across halves, ≥10 m in opposition half).',
  progressive_carries: 'Carries meeting the same distance-to-goal thresholds as progressive passes.',
  pressures: 'Times the player closed down the ball carrier within ~3 m.',
  pressure_regains: 'Possession won within 5 seconds of the player pressing.',
  hsr_distance_m: 'High-speed running: distance covered above 19.8 km/h.',
  sprint_count: 'Efforts above 25.2 km/h sustained for at least one second.',
  key_passes: 'Passes immediately followed by a shot from the receiver.',
};

const TEAM_DEFINITIONS: Record<(typeof TEAM_METRICS)[number], string> = {
  goals: 'Goals scored.',
  xg: 'Total expected goals.',
  shots: 'Total shots.',
  possession_pct: 'Share of on-ball actions (%).',
  passes: 'Passes attempted.',
  pass_accuracy: 'Completed passes / attempted (%).',
  ppda: 'Passes allowed per defensive action in the opponent’s defensive 60% of the pitch. LOWER = more aggressive pressing (elite pressing sides sit around 7–10).',
  field_tilt: 'Share of final-third passes made by this team (%); a territorial-dominance measure.',
  progressive_passes: 'Team progressive passes.',
  pressures: 'Team pressures on the ball carrier.',
  high_regains: 'Possession won in the attacking 35% of the pitch.',
  distance_km: 'Total distance covered by the team (km).',
};

/** Stable, cacheable metric glossary appended to every system prompt. */
export const METRIC_GLOSSARY = [
  '## Metric glossary',
  '### Player metrics (keys you may cite)',
  ...PlayerMetricKey.options.map((k) => {
    const m = METRIC_META[k];
    const def = DEFINITIONS[k];
    return `- \`${k}\` — ${m.label}${m.unit ? ` (${m.unit})` : ''}${def ? `: ${def}` : ''}`;
  }),
  '- `rating` — 0–10 composite match rating from the analytics engine (6.0 ≈ average).',
  '- `<metric>_percentile` — percentile (0–100) of the per-90 value against the benchmark cohort.',
  '- `avg_rating`, `matches`, `minutes`, `rating_slope` (rating change per match), `projected_rating`.',
  '### Team metrics (keys you may cite)',
  ...TEAM_METRICS.map((k) => `- \`${k}\` — ${TEAM_DEFINITIONS[k]}`),
].join('\n');
