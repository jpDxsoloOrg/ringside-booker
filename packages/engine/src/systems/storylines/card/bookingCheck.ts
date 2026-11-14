/**
 * The storyline links booking check (CRTV4-01, `storylines.links`). Every issue is a warning: a
 * link that won't count never stops a show from running.
 *
 * - `storylines.noMemberInSegment`: the segment is linked to a storyline but none of its members
 *   is in it, so it won't count (the heat step skips it).
 * - `storylines.linkedStorylineEnded`: the segment is linked to a storyline that has ended.
 * - `storylines.finaleNotAMatch`: a storyline's finale is a segment on this card that is no longer
 *   a match. Booking clears such finales, so this is defensive.
 *
 * Design: docs/design/storylines.md#linking.
 */

import { registerBookingCheck } from '../../booking/validate/registry';
import { placeOf } from '../../booking/validate/checks/shared';
import type {
  BookingCheck,
  BookingCheckInput,
  BookingIssueDraft,
} from '../../booking/validate/types';
import { membersInSegment } from './membersInSegment';

export const STORYLINE_LINKS_CHECK_ID = 'storylines.links';

/** The warning codes this check reports. */
export const STORYLINE_LINK_WARNINGS = {
  noMemberInSegment: 'storylines.noMemberInSegment',
  linkedStorylineEnded: 'storylines.linkedStorylineEnded',
  finaleNotAMatch: 'storylines.finaleNotAMatch',
} as const;

const CODES = STORYLINE_LINK_WARNINGS;

function run(input: BookingCheckInput): BookingIssueDraft[] {
  const issues: BookingIssueDraft[] = [];
  const onCard = new Set(input.segments.map((segment) => segment.id));
  for (const segment of input.segments) {
    const where = {
      segmentId: segment.id,
      slot: { preShow: segment.preShow, slot: segment.slot },
    };
    for (const storylineId of segment.storylineIds) {
      const storyline = input.read.tables.storylines.get(storylineId);
      if (storyline === undefined) {
        continue;
      }
      if (storyline.status !== 'active') {
        issues.push({
          code: CODES.linkedStorylineEnded,
          severity: 'warning',
          message: `'${storyline.name}' has ended: this link won't count`,
          ...where,
        });
        continue;
      }
      if (membersInSegment(input.read, storyline.id, segment.id).length === 0) {
        issues.push({
          code: CODES.noMemberInSegment,
          severity: 'warning',
          message: `${placeOf(input, segment)} is linked to '${storyline.name}' but none of its members is in it: it won't count`,
          ...where,
        });
      }
    }
  }
  for (const storyline of input.read.tables.storylines.lookup(
    'byPromotion',
    input.instance.promotionId,
  )) {
    const finaleId = storyline.finaleSegmentId;
    if (finaleId === null || !onCard.has(finaleId)) {
      continue;
    }
    const finale = input.segments.find((segment) => segment.id === finaleId);
    if (finale !== undefined && finale.kind !== 'match') {
      issues.push({
        code: CODES.finaleNotAMatch,
        severity: 'warning',
        message: `'${storyline.name}' finale is in ${placeOf(input, finale)}, but it is no longer a match`,
        segmentId: finale.id,
        slot: { preShow: finale.preShow, slot: finale.slot },
      });
    }
  }
  return issues;
}

export const storylineLinksBookingCheck: BookingCheck = {
  id: STORYLINE_LINKS_CHECK_ID,
  order: 250,
  label: 'Storyline links count',
  run,
};

registerBookingCheck(storylineLinksBookingCheck);
