import { useMemo } from 'react';
import type {
  AvailableTeamRow,
  AvailableWorkerRow,
  BookingCard,
  EventInstanceId,
  PersonId,
  TeamId,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { SegmentEditorKind } from './editorStore';

const NO_PEOPLE: readonly AvailableWorkerRow[] = [];
const NO_TEAMS: readonly AvailableTeamRow[] = [];

/** The show's roster for one kind of segment, by person and by team. */
export interface RosterIndex {
  readonly people: ReadonlyMap<PersonId, AvailableWorkerRow>;
  readonly teams: ReadonlyMap<TeamId, AvailableTeamRow>;
  readonly loading: boolean;
}

/**
 * Everyone `booking.availableWorkers` lists for the show and kind, with no search: the names,
 * pictures and availability the side builder shows for the people in the draft.
 */
export function useRosterIndex(
  eventInstanceId: EventInstanceId,
  kind: SegmentEditorKind,
  enabled = true,
): RosterIndex {
  const query = useEngineQuery(
    'booking.availableWorkers',
    { eventInstanceId, kind },
    { enabled, keepPreviousData: true },
  );
  const peopleRows = query.data?.people ?? NO_PEOPLE;
  const teamRows = query.data?.teams ?? NO_TEAMS;
  return useMemo(
    () => ({
      people: new Map(peopleRows.map((row) => [row.personId, row])),
      teams: new Map(teamRows.map((row) => [row.teamId, row])),
      loading: query.status === 'loading',
    }),
    [peopleRows, teamRows, query.status],
  );
}

/**
 * A person's name when the roster no longer lists them (released since they were booked): the
 * card's own view of the segment still has it.
 */
export function cardNameOf(card: BookingCard, personId: PersonId): string | null {
  for (const section of card.sections) {
    for (const slot of section.slots) {
      for (const side of slot.segment?.sides ?? []) {
        const person = side.people.find((candidate) => candidate.personId === personId);
        if (person !== undefined) return person.ringName;
      }
    }
  }
  return null;
}
