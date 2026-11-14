/**
 * Which old matches the history roll-up keeps (POL4-08). A segment of a show older than the detail
 * window is deleted with its participants unless something still reads it:
 *
 * - a title reign won or lost in it (`wonInSegmentId`, `endedInSegmentId`): title lineage is kept
 *   in full;
 * - a stored aftermath row (each worker's newest `match.aftermath.keepPerPerson`): the weekly
 *   momentum drift and Recent form read them;
 * - each competitor's newest run matches, as many as the win-streak bonus looks back
 *   (`match.popularity.streakLookback`) or Recent form can list, whichever is more: so a streak
 *   and the Form tab read exactly what they read before the roll-up;
 * - each title's newest matches the rival booker reads for its last defence and its recent
 *   challengers (`aip.titles.recentChallengers`);
 * - a segment someone was injured in (WRK6-03): injury rows are part of a worker's record and keep
 *   their `segmentId`;
 * - a storyline's finale segment (`finaleSegmentId`, CRTV3-01): the storyline keeps pointing at it.
 *
 * The set only depends on the world, so a roll-up is deterministic.
 */

import { addDays, type GameDate } from '../../core/date';
import type { PersonId, SegmentId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import { recentTitleMatchIds } from '../aip/card/titleHistory';
import { priorMatchesOf } from '../match/aftermath/history';
import { RECENT_FORM_MAX_LIMIT } from '../match/aftermath/recentFormQuery';
import type { EngineTunables } from '../tunables';

/** How many newest run matches each competitor keeps whatever their age. */
export function matchesKeptPerWorker(tunables: EngineTunables): number {
  return Math.max(tunables.get('match.popularity.streakLookback'), RECENT_FORM_MAX_LIMIT);
}

/** The segments the roll-up must not delete on `today`, whatever their age. */
export function segmentsToKeep(
  read: GameWorldView,
  today: GameDate,
  tunables: EngineTunables,
): Set<SegmentId> {
  const keep = new Set<SegmentId>();
  for (const reign of read.tables.titleReigns.values()) {
    if (reign.wonInSegmentId !== null) {
      keep.add(reign.wonInSegmentId);
    }
    if (reign.endedInSegmentId !== null) {
      keep.add(reign.endedInSegmentId);
    }
  }
  for (const row of read.tables.aftermaths.values()) {
    keep.add(row.segmentId);
  }
  for (const injury of read.tables.injuries.values()) {
    if (injury.segmentId !== null) {
      keep.add(injury.segmentId);
    }
  }
  for (const storyline of read.tables.storylines.values()) {
    if (storyline.finaleSegmentId !== null) {
      keep.add(storyline.finaleSegmentId);
    }
  }

  const competitors = new Set<PersonId>();
  for (const participant of read.tables.participants.values()) {
    if (participant.role === 'competitor') {
      competitors.add(participant.personId);
    }
  }
  // Tomorrow, on no show: every match run up to and including today counts, as for Recent form.
  const after = {
    date: addDays(today, 1),
    eventInstanceId: null,
    preShow: false,
    slot: 0,
    segmentId: null,
  };
  const perWorker = matchesKeptPerWorker(tunables);
  for (const personId of competitors) {
    for (const match of priorMatchesOf(read, personId, after, perWorker)) {
      keep.add(match.segmentId);
    }
  }

  const challengers = Math.max(1, tunables.get('aip.titles.recentChallengers'));
  for (const title of read.tables.titles.values()) {
    for (const segmentId of recentTitleMatchIds(read, title.id, challengers)) {
      keep.add(segmentId);
    }
  }
  return keep;
}
