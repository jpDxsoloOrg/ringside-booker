/**
 * `storylines.linkOptions` (CRTV4-01): what the Booking editor's Storylines section shows for one
 * segment. The storylines it is linked to (with who from each is in it and where each finale is),
 * suggestions (active storylines with a member in the segment, not yet linked) and the other
 * active storylines it could be linked to.
 *
 * Only for shows the viewer runs; anyone else gets `{ kind: 'unavailable' }`.
 *
 * Design: docs/design/storylines.md#linking.
 */

import { z } from 'zod';
import { viewerControlsShow } from '../../calendar/control';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import type { Reason } from '../../../core/api/result';
import type { EventInstanceId, PersonId, SegmentId, StorylineId } from '../../../core/ids';
import { zId } from '../../../model/primitives';
import { editBlockOf } from '../../booking/control';
import { linkableStorylines, segmentPlace, segmentWithShow, STORYLINE_LINK_REASONS } from './links';
import { membersInSegment } from './membersInSegment';

/** Where a storyline's finale is booked when it is not this segment. */
export interface StorylineFinaleElsewhere {
  segmentId: SegmentId;
  eventInstanceId: EventInstanceId;
  showName: string;
  /** The slot as the booking screen names it: "Slot 3", "Pre-show slot 1". */
  slot: string;
}

/** A storyline the segment is linked to. */
export interface StorylineLinkedRow {
  storylineId: StorylineId;
  name: string;
  heat: number;
  /** False for a storyline that has ended since it was linked: the link won't count. */
  active: boolean;
  /** Its members in this segment, id order. Empty: the link won't count. */
  membersHere: PersonId[];
  isFinale: boolean;
  finaleElsewhere: StorylineFinaleElsewhere | null;
}

/** An active storyline with a member in the segment that is not linked yet. */
export interface StorylineSuggestionRow {
  storylineId: StorylineId;
  name: string;
  heat: number;
  membersHere: PersonId[];
}

/** Any other active storyline the segment could be linked to. */
export interface StorylineOtherRow {
  storylineId: StorylineId;
  name: string;
  heat: number;
}

export type StorylineLinkOptions =
  | {
      kind: 'ok';
      linked: StorylineLinkedRow[];
      suggestions: StorylineSuggestionRow[];
      others: StorylineOtherRow[];
      /** True for a match on a card that can still change. */
      canSetFinale: boolean;
      /** `storylines.link.maxPerSegment`. */
      maxLinks: number;
      /** True when the card can no longer change (the show has run, was cancelled or is past). */
      locked: boolean;
    }
  | { kind: 'unavailable'; reason: Reason };

declare module '../../../core/api/maps' {
  interface QueryMap {
    'storylines.linkOptions': { args: { segmentId: SegmentId }; result: StorylineLinkOptions };
  }
}

export const storylinesLinkOptionsQuery: QueryDefinition<'storylines.linkOptions'> = defineQuery(
  'storylines.linkOptions',
  {
    args: z.strictObject({ segmentId: zId('segment') }),
    run: (ctx, args): StorylineLinkOptions => {
      const { read } = ctx;
      const found = segmentWithShow(read, args.segmentId);
      if ('code' in found) {
        return { kind: 'unavailable', reason: found };
      }
      const { segment, show } = found;
      if (!viewerControlsShow(read, show, ctx.viewer)) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_LINK_REASONS.notYourShow,
            message: `${show.name} isn't one of your shows`,
            subject: { kind: 'eventInstance', id: show.id },
          },
        };
      }
      const locked = editBlockOf(read, show, ctx.date) !== null;

      const linked: StorylineLinkedRow[] = [];
      for (const storylineId of segment.storylineIds) {
        const storyline = read.tables.storylines.get(storylineId);
        if (storyline === undefined) {
          continue;
        }
        let finaleElsewhere: StorylineFinaleElsewhere | null = null;
        const finaleId = storyline.finaleSegmentId;
        if (finaleId !== null && finaleId !== segment.id) {
          const finale = read.tables.segments.get(finaleId);
          const finaleShow =
            finale === undefined
              ? undefined
              : read.tables.eventInstances.get(finale.eventInstanceId);
          if (finale !== undefined && finaleShow !== undefined) {
            finaleElsewhere = {
              segmentId: finale.id,
              eventInstanceId: finaleShow.id,
              showName: finaleShow.name,
              slot: segmentPlace(finale),
            };
          }
        }
        linked.push({
          storylineId: storyline.id,
          name: storyline.name,
          heat: storyline.heat,
          active: storyline.status === 'active',
          membersHere: membersInSegment(read, storyline.id, segment.id),
          isFinale: finaleId === segment.id,
          finaleElsewhere,
        });
      }

      const linkedIds = new Set<StorylineId>(segment.storylineIds);
      const suggestions: StorylineSuggestionRow[] = [];
      const others: StorylineOtherRow[] = [];
      for (const storyline of linkableStorylines(read, show)) {
        if (linkedIds.has(storyline.id)) {
          continue;
        }
        const membersHere = membersInSegment(read, storyline.id, segment.id);
        if (membersHere.length > 0) {
          suggestions.push({
            storylineId: storyline.id,
            name: storyline.name,
            heat: storyline.heat,
            membersHere,
          });
        } else {
          others.push({ storylineId: storyline.id, name: storyline.name, heat: storyline.heat });
        }
      }
      // Members present (most first), then heat (hottest first); linkableStorylines is id order,
      // so the stable sort keeps id order for ties.
      suggestions.sort(
        (left, right) =>
          right.membersHere.length - left.membersHere.length || right.heat - left.heat,
      );

      return {
        kind: 'ok',
        linked,
        suggestions,
        others,
        canSetFinale: segment.kind === 'match' && !locked,
        maxLinks: ctx.tunables.get('storylines.link.maxPerSegment'),
        locked,
      };
    },
  },
);

export const storylinesCardQueries = [storylinesLinkOptionsQuery] as const;
