/**
 * What the built-in booking checks share: names in player words, where a segment sits on the card,
 * and the promotion's roster read once per validation.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import { compareDates } from '../../../../core/date';
import type { PersonId, PromotionId } from '../../../../core/ids';
import type { Employment } from '../../../../model/entities/employment';
import type { Participant, ParticipantRole } from '../../../../model/entities/participant';
import type { Segment } from '../../../../model/entities/segment';
import type { GameWorldView } from '../../../../model/tables';
import type { DeepReadonly } from '../../../../model/world';
import { SLOT_ROLE_LABELS, slotRoleOf } from '../../../match/slots';
import { activeRosterOf, slotLabel } from '../../view';
import type { BookingCheckInput, BookingIssueDraft } from '../types';

/** The roster of each promotion, read once per validation even when several checks ask. */
const rosterCache = new WeakMap<
  BookingCheckInput,
  ReadonlyMap<PersonId, DeepReadonly<Employment>>
>();

/** The show's promotion's active contracts, by person. */
export function rosterFor(
  input: BookingCheckInput,
): ReadonlyMap<PersonId, DeepReadonly<Employment>> {
  const cached = rosterCache.get(input);
  if (cached !== undefined) {
    return cached;
  }
  const roster = activeRosterOf(input.read, input.instance.promotionId);
  rosterCache.set(input, roster);
  return roster;
}

/**
 * The ring name on the show's promotion's contract (an ended one when that is all there is), else
 * the person's default ring name.
 */
export function nameOf(input: BookingCheckInput, personId: PersonId): string {
  const active = rosterFor(input).get(personId);
  if (active !== undefined) {
    return active.ringName;
  }
  const lastHere = input.read.tables.employments
    .lookup('byPerson', personId)
    .filter((employment) => employment.promotionId === input.instance.promotionId)
    .sort((left, right) => compareDates(right.startsOn, left.startsOn))
    .at(0);
  return (
    lastHere?.ringName ??
    input.read.tables.people.get(personId)?.defaultRingName ??
    'Someone no longer in the game'
  );
}

/** The promotion's name for messages. */
export function promotionName(read: GameWorldView, promotionId: PromotionId): string {
  return read.tables.promotions.get(promotionId)?.name ?? 'this promotion';
}

/** "The Boreal Championship", without doubling a name that already starts with "The". */
export function theTitle(name: string): string {
  return /^the /i.test(name) ? name : `The ${name}`;
}

/**
 * Where a segment sits, as the booking screen names it: the slot's role when only one slot has it
 * ("Opener", "Main event", "Semi-main"), else its slot ("Slot 3", "Pre-show slot 1").
 */
export function placeOf(input: BookingCheckInput, segment: DeepReadonly<Segment>): string {
  const { slots } = input.instance.format;
  if (segment.preShow || segment.slot >= slots) {
    return slotLabel(segment.preShow, segment.slot);
  }
  const role = slotRoleOf(
    { slot: segment.slot + 1, slots, preShow: false },
    { tunables: input.tunables },
  ).value;
  return role === 'midcard' ? slotLabel(false, segment.slot) : SLOT_ROLE_LABELS[role];
}

/** The fields every issue about a segment carries. */
export function at(segment: DeepReadonly<Segment>): Pick<BookingIssueDraft, 'segmentId' | 'slot'> {
  return { segmentId: segment.id, slot: { preShow: segment.preShow, slot: segment.slot } };
}

export function participantsOf(
  input: BookingCheckInput,
  segment: DeepReadonly<Segment>,
): readonly DeepReadonly<Participant>[] {
  return input.participantsBySegment.get(segment.id) ?? [];
}

/** The roles in a match that wrestle; everyone else in a match only talks or stands at ringside. */
const WRESTLING_PARTICIPANT_ROLES: readonly ParticipantRole[] = ['competitor', 'interferer'];

/** True when `role` in `segment` means wrestling, so it needs someone fit to wrestle. */
export function wrestlesIn(segment: DeepReadonly<Segment>, role: ParticipantRole): boolean {
  return segment.kind === 'match' && WRESTLING_PARTICIPANT_ROLES.includes(role);
}

/** The competitors of a match, grouped by side (ascending). */
export function competitorSides(
  input: BookingCheckInput,
  segment: DeepReadonly<Segment>,
): { side: number; personIds: PersonId[] }[] {
  const sides = new Map<number, PersonId[]>();
  for (const participant of participantsOf(input, segment)) {
    if (participant.role !== 'competitor') {
      continue;
    }
    const list = sides.get(participant.side) ?? [];
    list.push(participant.personId);
    sides.set(participant.side, list);
  }
  return [...sides.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, personIds]) => ({ side, personIds }));
}

const NUMBER_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
] as const;

/** "Three", or "31" past twelve. */
export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "2", or "2 to 4". */
export function rangeText(range: { readonly min: number; readonly max: number }): string {
  return range.min === range.max
    ? String(range.min)
    : `${String(range.min)} to ${String(range.max)}`;
}

export function outside(
  count: number,
  range: { readonly min: number; readonly max: number },
): boolean {
  return count < range.min || count > range.max;
}

/** "Side 2" for stored side 1. */
export function sideName(side: number): string {
  return `Side ${String(side + 1)}`;
}
