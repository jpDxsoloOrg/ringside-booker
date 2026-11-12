/**
 * The warning checks: things the booker should know about but may book anyway. They never block
 * locking a card.
 *
 * - `appearanceCap`: the contract caps appearances and this show would go past it
 *   (`appearancesThisYear + 1 > cap`). Shows already locked but not yet run are not counted.
 * - `noHouseShows`: the contract rules out house shows and this show is one.
 * - `otherBrand`: the person is contracted to another brand than the show's.
 * - `titleOtherBrand`: a title on the line belongs to another brand than the show's.
 * - `titleDivision`: a challenger (a competitor who does not hold the title) is outside its
 *   division, by WRK1's `isEligibleForTitle` (gender or weight). An owner may want a cruiserweight
 *   to challenge upward as a story, so this only warns.
 * - `injuredTalking`: an injured worker who can still work angles is booked to talk.
 *
 * The first three are per person, on the first segment they are in.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { BrandId, PersonId } from '../../../../core/ids';
import type { TitleEligibilityCode } from '../../../workers/helpers/eligibility';
import { isEligibleForTitle } from '../../../workers/helpers/eligibility';
import { availabilityOf } from '../../../workers/helpers/availability';
import { isOtherBrand } from '../../view';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import {
  at,
  competitorSides,
  nameOf,
  participantsOf,
  rosterFor,
  theTitle,
  wrestlesIn,
} from './shared';

export const WARNINGS_CHECK_ID = 'booking.warnings';

/** The eligibility rules that are a division question; the others are errors elsewhere. */
const DIVISION_CODES: readonly TitleEligibilityCode[] = [
  'divisionGender',
  'belowMinWeight',
  'aboveMaxWeight',
];

function brandName(input: BookingCheckInput, brandId: BrandId): string {
  return input.read.tables.brands.get(brandId)?.name ?? 'another brand';
}

function contractIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { read, instance } = input;
  const roster = rosterFor(input);
  const issues: BookingIssueDraft[] = [];
  const seen = new Set<PersonId>();
  for (const segment of input.segments) {
    for (const participant of participantsOf(input, segment)) {
      const { personId } = participant;
      const employment = roster.get(personId);
      const person = read.tables.people.get(personId);
      if (employment === undefined || person === undefined) {
        continue;
      }
      const where = { ...at(segment), personId };
      const name = nameOf(input, personId);
      const availability = availabilityOf(person, employment, instance.date);
      if (
        availability.status === 'injured' &&
        availability.canWorkAngles &&
        !wrestlesIn(segment, participant.role)
      ) {
        issues.push({
          code: 'injuredTalking',
          severity: 'warning',
          message: `${name} is injured: can talk but not wrestle`,
          ...where,
        });
      }
      if (seen.has(personId)) {
        continue;
      }
      seen.add(personId);
      const cap = employment.terms.appearanceCap;
      if (cap !== null && employment.appearancesThisYear + 1 > cap) {
        issues.push({
          code: 'appearanceCap',
          severity: 'warning',
          message: `${name} has used ${String(employment.appearancesThisYear)} of ${String(cap)} contracted appearances this year`,
          ...where,
        });
      }
      if (employment.terms.perks.noHouseShows && instance.importance === 'house') {
        issues.push({
          code: 'noHouseShows',
          severity: 'warning',
          message: `${name}'s contract rules out house shows`,
          ...where,
        });
      }
      if (employment.brandId !== null && isOtherBrand(employment.brandId, instance.brandId)) {
        issues.push({
          code: 'otherBrand',
          severity: 'warning',
          message: `${name} works for ${brandName(input, employment.brandId)}`,
          ...where,
        });
      }
    }
  }
  return issues;
}

function titleWarnings(input: BookingCheckInput): BookingIssueDraft[] {
  const { read, instance } = input;
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    if (segment.kind !== 'match') {
      continue;
    }
    const competitors = competitorSides(input, segment).flatMap((side) => side.personIds);
    for (const titleId of segment.match.titleIds) {
      const title = read.tables.titles.get(titleId);
      if (title === undefined) {
        continue;
      }
      const onTitle = { ...at(segment), titleId };
      if (isOtherBrand(title.brandId, instance.brandId) && title.brandId !== null) {
        issues.push({
          code: 'titleOtherBrand',
          severity: 'warning',
          message: `${theTitle(title.name)} belongs to ${brandName(input, title.brandId)}`,
          ...onTitle,
        });
      }
      const holders = new Set(
        read.tables.titleReigns.lookupOne('openByTitle', titleId)?.holderIds ?? [],
      );
      for (const personId of competitors) {
        const person = read.tables.people.get(personId);
        if (person === undefined || holders.has(personId)) {
          continue;
        }
        for (const reason of isEligibleForTitle(person, title)) {
          if (DIVISION_CODES.some((code) => code === reason.code)) {
            issues.push({
              code: 'titleDivision',
              severity: 'warning',
              message: `${nameOf(input, personId)}: ${reason.message}`,
              ...onTitle,
              personId,
            });
          }
        }
      }
    }
  }
  return issues;
}

export const warningsCheck: BookingCheck = {
  id: WARNINGS_CHECK_ID,
  order: 190,
  run: (input) => [...contractIssues(input), ...titleWarnings(input)],
};
