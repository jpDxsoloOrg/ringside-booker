/**
 * The structure checks (errors): every segment fits its type, every match has a planned result,
 * and the card is filled enough to run.
 *
 * - `sideCount`: the match's competitor sides are outside its type's `sides` range.
 * - `sideSize`: a competitor side is outside the type's `sideSize` range.
 * - `unequalSides`: a type with `equalSides` has sides of different sizes (only when every side's
 *   size is allowed on its own; a wrong-sized side already says what is wrong).
 * - `speakerCount`: an angle's speakers are outside its type's `speakers` range.
 * - `noPlannedResult`: a match's `outcome` is null and it is not left to the night as Auto or
 *   Random (`match.resultPlan`, MTCH2-08). Skipped on a show whose results Random winners
 *   decides (MTCH2's `randomWinnersActive`): there every result is decided on the night.
 * - `tooFewFilled`: fewer main-card slots are filled than `minFilledMainSlots`.
 * - `emptyMainEvent`: the last main-card slot is open, while `booking.requireMainEvent` is on.
 *
 * A segment whose type has left the catalog is skipped here; the card writer refuses those.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import { angleTypeOf, matchTypeOf } from '../../../../model/catalogs';
import { randomWinnersActive } from '../../../match/finishes/randomWinners';
import { minFilledMainSlots } from '../../formulas/minFilledMainSlots';
import { slotLabel } from '../../view';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import {
  at,
  competitorSides,
  countWord,
  outside,
  participantsOf,
  placeOf,
  plural,
  rangeText,
  sideName,
} from './shared';

export const STRUCTURE_CHECK_ID = 'booking.structure';

/** "a Singles match", "an Endurance Match". */
function matchPhrase(name: string): string {
  const article = /^[aeiou]/i.test(name) ? 'an' : 'a';
  return /match$/i.test(name) ? `${article} ${name}` : `${article} ${name} match`;
}

/** "a Promo", "an Interview". */
function anglePhrase(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

function segmentIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const issues: BookingIssueDraft[] = [];
  const decidedOnTheNight = randomWinnersActive(input.read, {
    promotionId: input.instance.promotionId,
    brandId: input.instance.brandId,
  });
  for (const segment of input.segments) {
    const where = at(segment);
    const place = placeOf(input, segment);
    if (segment.kind === 'angle') {
      const angleType = angleTypeOf(input.read, segment.angle.angleTypeKey);
      if (angleType === undefined) {
        continue;
      }
      const speakers = participantsOf(input, segment).filter(
        (participant) => participant.role === 'speaker',
      ).length;
      if (outside(speakers, angleType.speakers)) {
        issues.push({
          code: 'speakerCount',
          severity: 'error',
          message: `${place}: ${countWord(speakers)} ${plural(speakers, 'speaker', 'speakers')} in ${anglePhrase(angleType.name)}; it takes ${rangeText(angleType.speakers)}`,
          ...where,
        });
      }
      continue;
    }

    const matchType = matchTypeOf(input.read, segment.match.matchTypeKey);
    if (matchType !== undefined) {
      const sides = competitorSides(input, segment);
      if (outside(sides.length, matchType.sides)) {
        issues.push({
          code: 'sideCount',
          severity: 'error',
          message: `${place}: ${countWord(sides.length)} ${plural(sides.length, 'side', 'sides')} in ${matchPhrase(matchType.name)}; it takes ${rangeText(matchType.sides)}`,
          ...where,
        });
      }
      let sizeWrong = false;
      for (const side of sides) {
        const size = side.personIds.length;
        if (outside(size, matchType.sideSize)) {
          sizeWrong = true;
          issues.push({
            code: 'sideSize',
            severity: 'error',
            message: `${place}: ${sideName(side.side)} has ${String(size)} ${plural(size, 'wrestler', 'wrestlers')}; ${matchType.name} takes ${rangeText(matchType.sideSize)} a side`,
            ...where,
          });
        }
      }
      const sizes = sides.map((side) => side.personIds.length);
      if (matchType.equalSides && !sizeWrong && new Set(sizes).size > 1) {
        issues.push({
          code: 'unequalSides',
          severity: 'error',
          message: `${place}: the sides are uneven (${sizes.map(String).join(' against ')}); ${matchType.name} takes equal sides`,
          ...where,
        });
      }
    }
    if (
      segment.outcome === null &&
      segment.match.resultPlan === undefined &&
      !decidedOnTheNight
    ) {
      issues.push({
        code: 'noPlannedResult',
        severity: 'error',
        message: `${place}: no result planned; pick a winner, Auto, Random, a draw or a no contest`,
        ...where,
      });
    }
  }
  return issues;
}

function fillIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { slots } = input.instance.format;
  const filled = new Set(
    input.segments
      .filter((segment) => !segment.preShow && segment.slot < slots)
      .map((segment) => segment.slot),
  );
  const issues: BookingIssueDraft[] = [];
  const needed = minFilledMainSlots({ slots }, { tunables: input.tunables }).value;
  if (filled.size < needed) {
    issues.push({
      code: 'tooFewFilled',
      severity: 'error',
      message: `Main card: ${String(filled.size)} of ${String(slots)} slots filled (needs ${String(needed)})`,
    });
  }
  const lastSlot = slots - 1;
  if (input.tunables.get('booking.requireMainEvent') && slots > 0 && !filled.has(lastSlot)) {
    issues.push({
      code: 'emptyMainEvent',
      severity: 'error',
      message: `The main event (${slotLabel(false, lastSlot)}) is empty`,
      slot: { preShow: false, slot: lastSlot },
    });
  }
  return issues;
}

export const structureCheck: BookingCheck = {
  id: STRUCTURE_CHECK_ID,
  order: 120,
  run: (input) => [...fillIssues(input), ...segmentIssues(input)],
};
