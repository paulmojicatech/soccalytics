import { Player, Team } from '@soccalytics/contracts';
import { ATTRIBUTE_KEYS } from './attributes.js';
import { generateLeague, LEAGUE_REFERENCE_DATE } from './league.js';

describe('generateLeague', () => {
  const league = generateLeague(42);

  it('is deterministic', () => {
    expect(generateLeague(42)).toEqual(league);
    expect(generateLeague(43).players[0]?.attributes).not.toEqual(league.players[0]?.attributes);
  });

  it('creates 8 valid teams with one pro reference side', () => {
    expect(league.teams).toHaveLength(8);
    for (const t of league.teams) {
      expect(() => Team.parse(t)).not.toThrow();
      expect(t.id).toMatch(/^team-[a-z0-9-]+$/);
      expect(t.primaryColor).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(league.teams.filter((t) => t.level === 'pro')).toHaveLength(1);
    expect(new Set(league.teams.map((t) => t.level)).size).toBeGreaterThanOrEqual(3);
  });

  it('creates 18-man squads with the right composition and unique ids/names', () => {
    expect(league.players).toHaveLength(8 * 18);
    expect(new Set(league.players.map((p) => p.id)).size).toBe(league.players.length);
    expect(new Set(league.players.map((p) => p.name)).size).toBe(league.players.length);
    for (const t of league.teams) {
      const squad = league.players.filter((p) => p.teamId === t.id);
      const count = (pos: string[]) => squad.filter((p) => pos.includes(p.position)).length;
      expect(squad).toHaveLength(18);
      expect(count(['GK'])).toBe(2);
      expect(count(['CB', 'FB'])).toBe(6);
      expect(count(['DM', 'CM', 'AM'])).toBe(6);
      expect(count(['W', 'ST'])).toBe(4);
      expect(new Set(squad.map((p) => p.shirtNumber)).size).toBe(18);
    }
  });

  it('draws plausible attributes and ages by level', () => {
    const ref = new Date(`${LEAGUE_REFERENCE_DATE}T00:00:00Z`).getTime();
    const age = (d: string) => (ref - new Date(`${d}T00:00:00Z`).getTime()) / (365.25 * 86400e3);
    for (const p of league.players) {
      expect(() => Player.parse(p)).not.toThrow();
      for (const k of ATTRIBUTE_KEYS) {
        expect(p.attributes[k]).toBeGreaterThanOrEqual(0);
        expect(p.attributes[k]).toBeLessThanOrEqual(100);
      }
      const team = league.teams.find((t) => t.id === p.teamId);
      if (team?.level === 'academy_u18') expect(age(p.birthDate)).toBeLessThan(19.01);
      if (team?.level === 'academy_u21') expect(age(p.birthDate)).toBeLessThan(22.01);
    }
    const mean = (lvl: string, key: 'passing' | 'finishing') => {
      const xs = league.players.filter((p) => league.teams.find((t) => t.id === p.teamId)?.level === lvl).map((p) => p.attributes[key]);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean('pro', 'passing')).toBeGreaterThan(mean('academy_u18', 'passing'));
    const gk = league.players.filter((p) => p.position === 'GK');
    const st = league.players.filter((p) => p.position === 'ST');
    const avg = (xs: typeof gk) => xs.reduce((a, p) => a + p.attributes.finishing, 0) / xs.length;
    expect(avg(st)).toBeGreaterThan(avg(gk) + 30);
  });
});
