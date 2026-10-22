import { MatchEvent, type MatchEventInput } from '@soccalytics/contracts';

let counter = 0;

/** Build a parsed MatchEvent with sensible defaults (test helper). */
export function makeEvent(partial: Partial<MatchEventInput> & Pick<MatchEventInput, 'type'>): MatchEvent {
  counter++;
  return MatchEvent.parse({
    id: `ev-${counter}`,
    matchId: 'm1',
    teamId: 'home',
    playerId: 'p1',
    period: 1,
    t: 0,
    start: { x: 50, y: 34 },
    end: partial.end ?? partial.start ?? { x: 50, y: 34 },
    success: true,
    ...partial,
  });
}
