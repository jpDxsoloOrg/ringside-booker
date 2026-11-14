/**
 * The rules for linking segments to storylines (CRTV4-01), shared by `storylines.linkOptions`,
 * `storylines.linkSegment`, `storylines.setFinale` and the booking check.
 *
 * A segment on a card can be tied to up to `storylines.link.maxPerSegment` active storylines of
 * the show's promotion (and of the show's brand, when the storyline has one). Links are always
 * explicit; the engine only suggests. One linked match per storyline can be its finale.
 *
 * Design: docs/design/storylines.md#linking.
 */

import type { Reason } from '../../../core/api/result';
import type { SegmentId } from '../../../core/ids';
import type { Controller } from '../../../model/controller';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { Segment } from '../../../model/entities/segment';
import type { Storyline } from '../../../model/entities/storyline';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { runnerName } from '../../booking/commands';
import { editBlockOf } from '../../booking/control';
import { slotLabel } from '../../booking/view';
import { controlsShow } from '../../calendar/control';

/** The reason codes the link commands and `storylines.linkOptions` return. */
export const STORYLINE_LINK_REASONS = {
  segmentNotFound: 'storylines.segmentNotFound',
  storylineNotFound: 'storylines.notFound',
  notYourShow: 'notYourShow',
  storylineEnded: 'storylines.storylineEnded',
  otherPromotion: 'storylines.otherPromotion',
  brandMismatch: 'storylines.brandMismatch',
  tooManyLinks: 'storylines.tooManyLinks',
  notAMatch: 'storylines.notAMatch',
  notLinked: 'storylines.notLinked',
  finaleAlreadyPlayed: 'storylines.finaleAlreadyPlayed',
} as const;

const CODES = STORYLINE_LINK_REASONS;

type Show = DeepReadonly<EventInstance>;
type StorylineRow = DeepReadonly<Storyline>;

/** Where a segment sits, as the booking screen names it: "Slot 3", "Pre-show slot 1". */
export function segmentPlace(segment: DeepReadonly<Pick<Segment, 'preShow' | 'slot'>>): string {
  return slotLabel(segment.preShow, segment.slot);
}

/** True when the storyline belongs to the show's promotion and, if it has a brand, the show's. */
export function storylineFitsShow(storyline: StorylineRow, show: Show): boolean {
  return (
    storyline.promotionId === show.promotionId &&
    (storyline.brandId === null || storyline.brandId === show.brandId)
  );
}

/** True when the segment has been rated, or its show has run: a finale there has been played. */
export function segmentWasPlayed(read: GameWorldView, segmentId: SegmentId): boolean {
  const segment = read.tables.segments.get(segmentId);
  if (segment === undefined) {
    return false;
  }
  if (segment.rating !== null) {
    return true;
  }
  return read.tables.eventInstances.get(segment.eventInstanceId)?.status === 'completed';
}

/**
 * Why `issuedBy` may not change the links of a segment on `show`: not their show, or a card that
 * cannot change any more (`showCompleted`, `showCancelled`, `showPast`). Empty when they may.
 */
export function cardRefusals(read: GameWorldView, show: Show, issuedBy: Controller): Reason[] {
  if (!controlsShow(read, show, issuedBy)) {
    return [
      {
        code: CODES.notYourShow,
        message: `Only the person running ${runnerName(read, show)} can link this show's segments to storylines`,
        subject: { kind: 'eventInstance', id: show.id },
      },
    ];
  }
  const blocked = editBlockOf(read, show, read.meta.currentDate);
  return blocked === null ? [] : [blocked];
}

/** The segment and its show, or the reason they can't be found. */
export function segmentWithShow(
  read: GameWorldView,
  segmentId: SegmentId,
): { segment: DeepReadonly<Segment>; show: Show } | Reason {
  const segment = read.tables.segments.get(segmentId);
  const show =
    segment === undefined ? undefined : read.tables.eventInstances.get(segment.eventInstanceId);
  if (segment === undefined || show === undefined) {
    return {
      code: CODES.segmentNotFound,
      message: 'That segment is no longer on the card',
      field: 'segmentId',
    };
  }
  return { segment, show };
}

/** Why `storyline` can't be newly linked to a segment on `show`; empty when it can. */
export function linkableReasons(
  read: GameWorldView,
  storyline: StorylineRow,
  show: Show,
  field: string,
): Reason[] {
  const subject = { kind: 'storyline', id: storyline.id } as const;
  if (storyline.promotionId !== show.promotionId) {
    const owner = read.tables.promotions.get(storyline.promotionId)?.name ?? 'another promotion';
    return [
      {
        code: CODES.otherPromotion,
        message: `'${storyline.name}' belongs to ${owner}, not to this show's promotion`,
        field,
        subject,
      },
    ];
  }
  if (storyline.status !== 'active') {
    return [
      {
        code: CODES.storylineEnded,
        message: `'${storyline.name}' has ended; only active storylines can be linked`,
        field,
        subject,
      },
    ];
  }
  if (!storylineFitsShow(storyline, show)) {
    const brand =
      storyline.brandId === null ? undefined : read.tables.brands.get(storyline.brandId);
    return [
      {
        code: CODES.brandMismatch,
        message: `'${storyline.name}' runs on ${brand?.name ?? 'another brand'}, not on this show's brand`,
        field,
        subject,
      },
    ];
  }
  return [];
}

/** The `tooManyLinks` refusal, naming the limit. */
export function tooManyLinksReason(limit: number): Reason {
  return {
    code: CODES.tooManyLinks,
    message:
      limit === 1
        ? 'A segment can count for only 1 storyline'
        : `A segment can count for at most ${String(limit)} storylines`,
    field: 'storylineIds',
  };
}

/** Active storylines that may be linked to a segment on `show`, in id order. */
export function linkableStorylines(read: GameWorldView, show: Show): StorylineRow[] {
  return read.tables.storylines
    .lookup('byPromotion', show.promotionId)
    .filter((storyline) => storyline.status === 'active' && storylineFitsShow(storyline, show))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * Storylines whose finale is `segmentId`, in id order. Reads every storyline, not the segment's
 * links, because a write may just have dropped the link.
 */
export function storylinesWithFinale(read: GameWorldView, segmentId: SegmentId): StorylineRow[] {
  return read.tables.storylines
    .values()
    .filter((storyline) => storyline.finaleSegmentId === segmentId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
