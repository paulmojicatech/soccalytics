import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const Position = z.enum(['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST']);
export type Position = z.infer<typeof Position>;

export const POSITION_LABEL: Record<Position, string> = {
  GK: 'Goalkeeper',
  CB: 'Centre-back',
  FB: 'Full-back',
  DM: 'Defensive midfielder',
  CM: 'Central midfielder',
  AM: 'Attacking midfielder',
  W: 'Winger',
  ST: 'Striker',
};

export const TeamLevel = z.enum(['academy_u16', 'academy_u18', 'academy_u21', 'semi_pro', 'pro']);
export type TeamLevel = z.infer<typeof TeamLevel>;

export const Team = z.object({
  id: Id,
  name: z.string(),
  shortName: z.string(),
  level: TeamLevel,
  primaryColor: z.string(),
  secondaryColor: z.string(),
});
export type Team = z.infer<typeof Team>;

export const Foot = z.enum(['left', 'right', 'both']);

export const Player = z.object({
  id: Id,
  teamId: Id,
  name: z.string(),
  shirtNumber: z.number().int(),
  position: Position,
  birthDate: z.iso.date(),
  heightCm: z.number().int().nullable(),
  foot: Foot,
  nationality: z.string().nullable(),
});
export type Player = z.infer<typeof Player>;

export const MatchStatus = z.enum(['scheduled', 'processing', 'analysed', 'failed']);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const MatchSource = z.enum(['video_upload', 'simulation', 'wearable_import']);
export type MatchSource = z.infer<typeof MatchSource>;

export const Match = z.object({
  id: Id,
  homeTeamId: Id,
  awayTeamId: Id,
  kickoffAt: Timestamp,
  competition: z.string(),
  venue: z.string().nullable(),
  status: MatchStatus,
  source: MatchSource,
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  durationSec: z.number().int().nullable(),
});
export type Match = z.infer<typeof Match>;

export const Lineup = z.object({
  matchId: Id,
  teamId: Id,
  playerId: Id,
  starter: z.boolean(),
  minutesPlayed: z.number(),
  position: Position,
});
export type Lineup = z.infer<typeof Lineup>;
