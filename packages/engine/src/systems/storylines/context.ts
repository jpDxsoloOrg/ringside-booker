/**
 * The engine-side storyline reader (CRTV3-01): one place other systems get a storyline's facts
 * from, instead of each writing its own reader of the `storylines` table. WRK8 (the story shield),
 * CRTV4 (heat after segments, the payoff) and AIP4 (rival cards) read it.
 *
 * Nothing here filters by viewer. These helpers are for engine-internal callers only: a query that
 * shows storylines to a player must scope them itself (see `rows.ts` and
 * docs/design/storylines.md#viewer-rules).
 *
 * Design: docs/design/storylines.md#context.
 */

import { diffDays, type GameDate } from '../../core/date';
import type { BrandId, PersonId, PromotionId, SegmentId, StorylineId } from '../../core/ids';
import type { Storyline, StorylineMember, StorylineStatus } from '../../model/entities/storyline';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** What the engine knows about one storyline on a given day. */
export interface StorylineContext {
  readonly storylineId: StorylineId;
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly name: string;
  readonly status: StorylineStatus;
  /** 0-100. */
  readonly heat: number;
  readonly startedOn: GameDate;
  /** The last day a linked segment moved the story on, or null when none has yet. */
  readonly lastProgressOn: GameDate | null;
  /** Days from `lastProgressOn` (or `startedOn` when there is none) to the date asked about. */
  readonly daysSinceProgress: number;
  /** In stored order. */
  readonly members: readonly DeepReadonly<StorylineMember>[];
  /** The segments that link the storyline and are still kept, in id order. */
  readonly linkedSegmentIds: readonly SegmentId[];
  /** The linked segment booked as the story's final match, or null. */
  readonly finaleSegmentId: SegmentId | null;
}

/**
 * The storyline `storylineId` as seen on `date`, or null when there is no such storyline. Not
 * filtered by viewer: queries must scope what they show.
 */
export function storylineContextFor(
  read: GameWorldView,
  storylineId: StorylineId,
  date: GameDate,
): StorylineContext | null {
  const storyline = read.tables.storylines.get(storylineId);
  if (storyline === undefined) {
    return null;
  }
  return {
    storylineId: storyline.id,
    promotionId: storyline.promotionId,
    brandId: storyline.brandId,
    name: storyline.name,
    status: storyline.status,
    heat: storyline.heat,
    startedOn: storyline.startedOn,
    lastProgressOn: storyline.lastProgressOn,
    daysSinceProgress: daysSinceProgress(storyline, date),
    members: storyline.members,
    linkedSegmentIds: linkedSegmentIdsOf(read, storyline.id),
    finaleSegmentId: storyline.finaleSegmentId,
  };
}

/** Days from the storyline's last progress (or its start, when it has none) to `date`. */
export function daysSinceProgress(
  storyline: Pick<DeepReadonly<Storyline>, 'lastProgressOn' | 'startedOn'>,
  date: GameDate,
): number {
  return diffDays(storyline.lastProgressOn ?? storyline.startedOn, date);
}

/** The ids of the kept segments that link `storylineId`, in id order. */
export function linkedSegmentIdsOf(read: GameWorldView, storylineId: StorylineId): SegmentId[] {
  return read.tables.segments
    .lookup('byStoryline', storylineId)
    .map((segment) => segment.id)
    .sort(compareIds);
}

/**
 * The storylines `personId` is a member of, in every promotion, in id order. With `status`, only
 * storylines in that status; without it, every storyline. Not filtered by viewer.
 */
export function storylinesOfPerson(
  read: GameWorldView,
  personId: PersonId,
  options: { readonly status?: StorylineStatus } = {},
): DeepReadonly<Storyline>[] {
  return read.tables.storylines
    .lookup('byMember', personId)
    .filter((storyline) => options.status === undefined || storyline.status === options.status)
    .sort((left, right) => compareIds(left.id, right.id));
}

/** The active storylines of `promotionId`, in id order. Not filtered by viewer. */
export function activeStorylinesOf(
  read: GameWorldView,
  promotionId: PromotionId,
): DeepReadonly<Storyline>[] {
  return read.tables.storylines
    .lookup('byPromotion', promotionId)
    .filter((storyline) => storyline.status === 'active')
    .sort((left, right) => compareIds(left.id, right.id));
}
