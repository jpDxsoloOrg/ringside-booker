/**
 * Who from a storyline is in a segment (CRTV4-01). A linked segment only counts for a storyline
 * when at least one member is in it, in any role: competitor, ringside, interferer, speaker or
 * subject. Suggestions, the booking check, the heat step (CRTV4-02) and the story shield (WRK8)
 * all read this one rule.
 *
 * Design: docs/design/storylines.md#linking.
 */

import type { PersonId, SegmentId, StorylineId } from '../../../core/ids';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';

/**
 * The storyline's members (any side) who are participants of the segment, id-sorted. Empty for an
 * unknown storyline or segment.
 */
export function membersInSegment(
  read: GameWorldView,
  storylineId: StorylineId,
  segmentId: SegmentId,
): PersonId[] {
  const storyline = read.tables.storylines.get(storylineId);
  if (storyline === undefined) {
    return [];
  }
  const members = new Set(storyline.members.map((member) => member.personId));
  const here = new Set<PersonId>();
  for (const participant of read.tables.participants.lookup('bySegment', segmentId)) {
    if (members.has(participant.personId)) {
      here.add(participant.personId);
    }
  }
  return [...here].sort(compareIds);
}
