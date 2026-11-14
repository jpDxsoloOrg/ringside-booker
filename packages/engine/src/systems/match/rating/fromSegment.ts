/**
 * The stored-segment adapter: a booked segment as a rating input, for EVT3 to rate a show.
 *
 * Reads the `segments` row (its kind and match or angle type), its participants (competitors for a
 * match, speakers for an angle, grouped by side, each side ordered by entrance order then id) and
 * its show (importance, region, date, promotion, the slot position and whether it is televised).
 * A completed match with an `outcome` and a `finishKey` also gets its `resolution` (MTCH2-02), so
 * its finish effects apply; any other segment gets `resolution: null`. A talking segment also gets
 * its beats, split into groups by side, and the beat keys earlier on the card (MTCH5-03).
 *
 * Design: docs/design/match-rating.md#the-stored-segment-adapter.
 */

import { EntityNotFoundError } from '../../../core/errors';
import type { PersonId, SegmentId } from '../../../core/ids';
import type { ContentKey } from '../../../core/content-key';
import { beatOf } from '../../../model/catalogs';
import type { Participant, ParticipantRole } from '../../../model/entities/participant';
import type { AngleSegment, Segment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { beatGroupsOf } from '../angles/beatGroups';
import type { MatchResolution } from '../finishes/resolution';
import type { SegmentAngleInput, SegmentRatingInput, SegmentRatingSide } from './types';

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

/** A completed match's outcome, finish and method; null unless the outcome and finish are set. */
function resolutionOf(segment: Segment): MatchResolution | null {
  if (segment.kind !== 'match' || segment.outcome === null || segment.match.finishKey === null) {
    return null;
  }
  const { outcome } = segment;
  return {
    outcome,
    finishKey: segment.match.finishKey,
    methodKey: outcome.kind === 'win' ? outcome.methodKey : null,
  };
}

/** Pre-show before the main card, then lower slot first. */
function compareCardOrder(left: DeepReadonly<Segment>, right: DeepReadonly<Segment>): number {
  if (left.preShow !== right.preShow) {
    return left.preShow ? -1 : 1;
  }
  return left.slot - right.slot;
}

/**
 * A talking segment's beats with their groups (MTCH5-03): a two-group beat splits its people by
 * the speakers' sides, and the beat keys of the talking segments earlier on the same card.
 */
function angleInputOf(
  read: GameWorldView,
  segment: DeepReadonly<AngleSegment>,
  participants: readonly Participant[],
): SegmentAngleInput {
  const sideByPerson = new Map(
    participants
      .filter((participant) => participant.role === 'speaker')
      .map((participant) => [participant.personId, participant.side]),
  );
  const beats = segment.angle.beats.map((beat) =>
    beatGroupsOf(beat, beatOf(read, beat.beatKey) ?? { groups: [] }, (personId) =>
      sideByPerson.get(personId),
    ),
  );
  const earlierBeatKeysOnCard: ContentKey[] = read.tables.segments
    .lookup('byEventInstance', segment.eventInstanceId)
    .filter((other) => other.id !== segment.id && compareCardOrder(other, segment) < 0)
    .sort(compareCardOrder)
    .flatMap((other) =>
      other.kind === 'angle' ? other.angle.beats.map((beat) => beat.beatKey) : [],
    );
  return { beats, earlierBeatKeysOnCard };
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
    resolution: resolutionOf(segment),
    ...(segment.kind === 'angle' ? { angle: angleInputOf(read, segment, participants) } : {}),
  };
}
