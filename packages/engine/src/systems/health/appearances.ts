/**
 * Who spent a show day talking rather than wrestling, for the owner rule "promos cost no stamina but
 * cost rest" (Sprint 4). Design: docs/design/health.md#fatigue-recovery.
 */

import { addDays, type GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';

/**
 * The people who spoke in a talking segment (an angle, promo or interview: a `speaker` in an angle)
 * on a show completed on `showDate`, and were not a competitor in any match on a show that day.
 * A match day already costs fatigue (MTCH4) and earns no rest bonus, so the two never stack.
 */
export function talkedWithoutWrestling(read: GameWorldView, showDate: GameDate): Set<PersonId> {
  const talked = new Set<PersonId>();
  const wrestled = new Set<PersonId>();
  const { eventInstances, segments, participants } = read.tables;
  for (const show of eventInstances.lookup('byDate', showDate)) {
    if (show.status !== 'completed') {
      continue;
    }
    for (const segment of segments.lookup('byEventInstance', show.id)) {
      for (const participant of participants.lookup('bySegment', segment.id)) {
        if (segment.kind === 'match' && participant.role === 'competitor') {
          wrestled.add(participant.personId);
        } else if (segment.kind === 'angle' && participant.role === 'speaker') {
          talked.add(participant.personId);
        }
      }
    }
  }
  for (const personId of wrestled) {
    talked.delete(personId);
  }
  return talked;
}

/**
 * The show day a morning's recovery follows: yesterday. The day's housekeeping runs before its
 * shows (rivals' in the `shows` group, the player's when they press Run the show), so the rest
 * that follows a show is the next morning's.
 */
export function restFollowsShowsOn(date: GameDate): GameDate {
  return addDays(date, -1);
}
