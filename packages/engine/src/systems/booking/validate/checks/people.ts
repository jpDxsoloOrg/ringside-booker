/**
 * The people checks (errors): everyone on the card can do what they are booked for on the show's
 * date, still works here, and anyone wrestling is a wrestler.
 *
 * - `personUnavailable`: WRK1's `availabilityOf` on the show's date is not `available`. Someone who
 *   only talks (any role in a talking segment, ringside in a match) is allowed when they can still
 *   work angles; `injuredTalking` warns about that instead.
 * - `notOnRoster`: their contract with the show's promotion ended since they were booked.
 * - `notAWrestler`: a match competitor without `wrestler` or `occasionalWrestler` among their roles.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { PersonId } from '../../../../core/ids';
import { WRESTLING_ROLES } from '../../../../model/entities/person';
import { availabilityText } from '../../../match/availabilityText';
import { availabilityOf } from '../../../workers/helpers/availability';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import {
  at,
  nameOf,
  participantsOf,
  placeOf,
  promotionName,
  rosterFor,
  wrestlesIn,
} from './shared';

export const PEOPLE_CHECK_ID = 'booking.people';

function peopleIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { read, instance } = input;
  const roster = rosterFor(input);
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    const seen = new Set<PersonId>();
    for (const participant of participantsOf(input, segment)) {
      const { personId } = participant;
      if (seen.has(personId)) {
        continue;
      }
      seen.add(personId);
      const where = { ...at(segment), personId };
      const person = read.tables.people.get(personId);
      if (person === undefined) {
        issues.push({
          code: 'notOnRoster',
          severity: 'error',
          message: `Someone in ${placeOf(input, segment)} is no longer in the game`,
          ...where,
        });
        continue;
      }
      const name = nameOf(input, personId);
      const employment = roster.get(personId);
      if (employment === undefined) {
        issues.push({
          code: 'notOnRoster',
          severity: 'error',
          message: `${name} is no longer on the ${promotionName(read, instance.promotionId)} roster`,
          ...where,
        });
        continue;
      }
      const wrestles = wrestlesIn(segment, participant.role);
      const availability = availabilityOf(person, employment, instance.date);
      if (availability.status !== 'available' && (wrestles || !availability.canWorkAngles)) {
        issues.push({
          code: 'personUnavailable',
          severity: 'error',
          message: `${name} can't ${wrestles ? 'wrestle' : 'appear'}: ${availabilityText(availability, input.today)}`,
          ...where,
        });
      }
      if (
        segment.kind === 'match' &&
        participant.role === 'competitor' &&
        !person.roles.some((role) => WRESTLING_ROLES.some((wrestling) => wrestling === role))
      ) {
        issues.push({
          code: 'notAWrestler',
          severity: 'error',
          message: `${name} isn't a wrestler, so can't compete in a match`,
          ...where,
        });
      }
    }
  }
  return issues;
}

export const peopleCheck: BookingCheck = {
  id: PEOPLE_CHECK_ID,
  order: 100,
  run: peopleIssues,
};
