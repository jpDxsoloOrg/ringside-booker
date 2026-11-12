/**
 * The stored-segment adapter: a booked segment as a rating input, for EVT3 to rate a show.
 *
 * Reads the `segments` row (its kind and match or angle type), its participants (competitors for a
 * match, speakers for an angle, grouped by side, each side ordered by entrance order then id) and
 * its show (importance, region, date, promotion, the slot position and whether it is televised).
 *
 * Design: docs/design/match-rating.md#the-stored-segment-adapter.
 */

import { EntityNotFoundError } from '../../../core/errors';
import type { PersonId, SegmentId } from '../../../core/ids';
import type { Participant, ParticipantRole } from '../../../model/entities/participant';
import type { GameWorldView } from '../../../model/tables';
import type { SegmentRatingInput, SegmentRatingSide } from './types';

/** Entrance order first (unordered entrants last), then id. */
function compareParticipants(left: Participant, right: Participant): number {
  const leftOrder = left.entranceOrder ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.entranceOrder ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** The participants in `role`, grouped by side (ascending), each side in entrance order. */
function sidesOf(participants: readonly Participant[], role: ParticipantRole): SegmentRatingSide[] {
  const bySide = new Map<number, Participant[]>();
  for (const participant of participants) {
    if (participant.role !== role) {
      continue;
    }
    bySide.set(participant.side, [...(bySide.get(participant.side) ?? []), participant]);
  }
  return [...bySide.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, members]) => ({
      side,
      personIds: [...members].sort(compareParticipants).map((member): PersonId => member.personId),
    }));
}

/**
 * The rating input for a stored segment. The slot is its position on the card: the stored 0-based
 * slot plus 1, out of the show format's main-card slots.
 *
 * @throws EntityNotFoundError when the segment or its show does not exist.
 */
export function ratingInputFromSegment(
  read: GameWorldView,
  segmentId: SegmentId,
): SegmentRatingInput {
  const segment = read.tables.segments.get(segmentId);
  if (segment === undefined) {
    throw new EntityNotFoundError('segment', segmentId);
  }
  const show = read.tables.eventInstances.get(segment.eventInstanceId);
  if (show === undefined) {
    throw new EntityNotFoundError('eventInstance', segment.eventInstanceId);
  }
  const participants = read.tables.participants.lookup('bySegment', segment.id);
  const definition =
    show.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(show.eventDefinitionId);
  const isMatch = segment.kind === 'match';
  return {
    kind: segment.kind,
    typeKey: isMatch ? segment.match.matchTypeKey : segment.angle.angleTypeKey,
    sides: sidesOf(participants, isMatch ? 'competitor' : 'speaker'),
    slot: { slot: segment.slot + 1, slots: show.format.slots, preShow: segment.preShow },
    event: {
      importance: show.importance,
      regionId: show.regionId,
      televised: definition?.televised ?? false,
      date: show.date,
    },
    promotionId: show.promotionId,
  };
}
