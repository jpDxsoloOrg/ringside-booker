/**
 * What the shows phase reads about one show before running it: its format, region, promotion,
 * brand, whether it is televised, its importance, and its card in running order with each
 * segment's people grouped into sides. Plus the two small rules every show night reader shares:
 * how a stored slot becomes MTCH1's slot position, and what marks a segment as run.
 *
 * Design: docs/design/show-night.md#phase.
 */

import { EntityNotFoundError } from '../../core/errors';
import type { BrandId, PersonId, PromotionId, RegionId, TeamId } from '../../core/ids';
import { compareIds } from '../../model/table';
import type { EventImportance } from '../../model/entities/event-definition';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Participant } from '../../model/entities/participant';
import type { Segment } from '../../model/entities/segment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { cardSegments } from '../booking/card';
import { showControllerOf } from '../calendar/control';
import type { SlotPosition } from '../match/slots';

/** One side of a segment: who is on it, and which of them compete. */
export interface ShowSide {
  /** The stored side, 0-based. */
  readonly side: number;
  /** Everyone on the side, by id. */
  readonly personIds: readonly PersonId[];
  /** The competitors on the side, by id (empty in an angle). */
  readonly competitorIds: readonly PersonId[];
  /** The teams listed on the side, by id. */
  readonly teamIds: readonly TeamId[];
}

/** One segment of the card, ready to run. */
export interface ShowSegment {
  readonly segment: DeepReadonly<Segment>;
  /** The slot as MTCH1 reads it (1-based). */
  readonly position: SlotPosition;
  readonly sides: readonly ShowSide[];
}

/** Everything the phase needs about one show. */
export interface ShowContext {
  readonly instance: DeepReadonly<EventInstance>;
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly regionId: RegionId;
  readonly regionName: string;
  readonly importance: EventImportance;
  readonly format: DeepReadonly<EventInstance['format']>;
  /** From the show's definition; a one-off show (no definition) is not televised. */
  readonly televised: boolean;
  /** True when a human player runs the show (its brand's controller when set, else its promotion's). */
  readonly humanShow: boolean;
  /** The card in running order: the pre-show first, then the main card, each by slot. */
  readonly segments: readonly ShowSegment[];
}

/**
 * A stored slot as MTCH1's slot position. Storage is 0-based and `slotRoleOf` takes 1-based slots,
 * so this adds one; the main card's slot count is the format's, whichever section the slot is in.
 */
export function slotRoleInput(
  segment: Pick<DeepReadonly<Segment>, 'slot' | 'preShow'>,
  format: DeepReadonly<EventInstance['format']>,
): SlotPosition {
  return { slot: segment.slot + 1, slots: format.slots, preShow: segment.preShow };
}

/**
 * True once show night has run the segment. A match's `outcome` holds the plan before the show and
 * the result after it, so the rating is what marks a segment as run.
 */
export function isSegmentRun(segment: Pick<DeepReadonly<Segment>, 'rating'>): boolean {
  return segment.rating !== null;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareIds);
}

/**
 * The segment's people grouped by side. In a match the competitors' sides are the sides; anyone
 * else (ringside, interferers) rides along on the side they are listed with. In an angle every
 * role defines its side. Sides come in side order, people and teams by id.
 */
export function sidesOf(
  segment: Pick<DeepReadonly<Segment>, 'kind'>,
  participants: readonly DeepReadonly<Participant>[],
): ShowSide[] {
  const isMatch = segment.kind === 'match';
  const defining = new Set(
    participants
      .filter((participant) => !isMatch || participant.role === 'competitor')
      .map((participant) => participant.side),
  );
  return [...defining]
    .sort((left, right) => left - right)
    .map((side) => {
      const onSide = participants.filter((participant) => participant.side === side);
      return {
        side,
        personIds: sortedUnique(onSide.map((participant) => participant.personId)),
        competitorIds: sortedUnique(
          onSide
            .filter((participant) => participant.role === 'competitor')
            .map((participant) => participant.personId),
        ),
        teamIds: sortedUnique(
          onSide.flatMap((participant) =>
            participant.teamId === null ? [] : [participant.teamId],
          ),
        ),
      };
    });
}

/**
 * Reads one show for the shows phase.
 *
 * @throws EntityNotFoundError when the show's promotion is not in the world.
 */
export function showContextOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
): ShowContext {
  if (!read.tables.promotions.has(instance.promotionId)) {
    throw new EntityNotFoundError('promotions', instance.promotionId);
  }
  const definition =
    instance.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(instance.eventDefinitionId);
  const segments = cardSegments(read, instance.id).map((segment): ShowSegment => ({
    segment,
    position: slotRoleInput(segment, instance.format),
    sides: sidesOf(segment, read.tables.participants.lookup('bySegment', segment.id)),
  }));
  return {
    instance,
    promotionId: instance.promotionId,
    brandId: instance.brandId,
    regionId: instance.regionId,
    regionName: read.tables.regions.get(instance.regionId)?.name ?? instance.regionId,
    importance: instance.importance,
    format: instance.format,
    televised: definition?.televised ?? false,
    humanShow: showControllerOf(read, instance).kind === 'human',
    segments,
  };
}
