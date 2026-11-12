/**
 * The card-wide checks (errors): nobody is booked more often than one show allows.
 *
 * - `alreadyOnCard`: a competitor in more matches than `booking.maxMatchesPerPersonPerShow`. Each
 *   match past the limit gets one issue naming the earlier ones ("Kai Moreno is already in a match on
 *   this card (Opener)").
 * - `tooManyAppearances`: someone in more segments of any kind, in any role, than
 *   `booking.maxAppearancesPerShow`. Each segment past the limit gets one issue.
 *
 * Both walk the card in running order, so the later segments are the ones flagged.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { PersonId } from '../../../../core/ids';
import type { Segment } from '../../../../model/entities/segment';
import type { DeepReadonly } from '../../../../model/world';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import { at, nameOf, participantsOf, placeOf } from './shared';

export const CARD_WIDE_CHECK_ID = 'booking.cardWide';

function cardWideIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const maxMatches = input.tunables.get('booking.maxMatchesPerPersonPerShow');
  const maxAppearances = input.tunables.get('booking.maxAppearancesPerShow');
  const matchesOf = new Map<PersonId, DeepReadonly<Segment>[]>();
  const appearancesOf = new Map<PersonId, number>();
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    const people = new Set<PersonId>();
    const competitors = new Set<PersonId>();
    for (const participant of participantsOf(input, segment)) {
      people.add(participant.personId);
      if (segment.kind === 'match' && participant.role === 'competitor') {
        competitors.add(participant.personId);
      }
    }
    for (const personId of competitors) {
      const earlier = matchesOf.get(personId) ?? [];
      if (earlier.length >= maxMatches) {
        const places = earlier.map((match) => placeOf(input, match)).join(', ');
        const already = earlier.length === 1 ? 'a match' : `${String(earlier.length)} matches`;
        issues.push({
          code: 'alreadyOnCard',
          severity: 'error',
          message: `${nameOf(input, personId)} is already in ${already} on this card (${places})`,
          ...at(segment),
          personId,
        });
      }
      matchesOf.set(personId, [...earlier, segment]);
    }
    for (const personId of people) {
      const count = (appearancesOf.get(personId) ?? 0) + 1;
      appearancesOf.set(personId, count);
      if (count > maxAppearances) {
        issues.push({
          code: 'tooManyAppearances',
          severity: 'error',
          message: `${nameOf(input, personId)} is in ${String(count)} segments on this card; the most is ${String(maxAppearances)}`,
          ...at(segment),
          personId,
        });
      }
    }
  }
  return issues;
}

export const cardWideCheck: BookingCheck = {
  id: CARD_WIDE_CHECK_ID,
  order: 110,
  run: cardWideIssues,
};
