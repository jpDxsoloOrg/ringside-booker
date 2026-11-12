/**
 * The card-wide checks: a person may be booked more than once on a card, but working several matches
 * is flagged and there is a hard limit so a card can't be absurd.
 *
 * - `workingTwice` (warning): a competitor in a second (or later) match within the limit. Each such
 *   match gets one warning naming the earlier ones ("Kai Moreno is also in the Opener: working twice
 *   tires them more and raises their injury risk"). Talking segments never warn: promos cost no
 *   stamina. The stamina and injury costs themselves are MTCH4-01, MTCH4-02 and WRK6-02.
 * - `alreadyOnCard` (error): a competitor in more matches than `booking.maxMatchesPerPersonPerShow`. Each
 *   match past the limit gets one issue naming the earlier ones ("Kai Moreno is already in a match on
 *   this card (Opener)").
 * - `tooManyAppearances`: someone in more segments of any kind, in any role, than
 *   `booking.maxAppearancesPerShow`. Each segment past the limit gets one issue.
 *
 * All three walk the card in running order, so the later segments are the ones flagged.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { PersonId } from '../../../../core/ids';
import type { Segment } from '../../../../model/entities/segment';
import type { DeepReadonly } from '../../../../model/world';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import { at, countWord, nameOf, participantsOf, placeOf } from './shared';

/** How often someone works, in player words: "twice", "three times". */
function timesWord(count: number): string {
  return count === 2 ? 'twice' : `${countWord(count).toLowerCase()} times`;
}

/** "the Opener" for a slot named by its role, "Slot 3" for one named by number. */
function inPlace(place: string): string {
  return /slot/i.test(place) ? place : `the ${place}`;
}

/** "the Opener", "the Opener and Slot 3", "the Opener, Slot 2 and Slot 3". */
function placesList(places: readonly string[]): string {
  const named = places.map(inPlace);
  const last = named.at(-1) ?? '';
  return named.length <= 1 ? last : `${named.slice(0, -1).join(', ')} and ${last}`;
}

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
      } else if (earlier.length > 0) {
        const places = placesList(earlier.map((match) => placeOf(input, match)));
        issues.push({
          code: 'workingTwice',
          severity: 'warning',
          message: `${nameOf(input, personId)} is also in ${places}: working ${timesWord(earlier.length + 1)} tires them more and raises their injury risk`,
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
