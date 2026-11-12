/**
 * Segment warnings: the booking problems the Match lab shows and EVT2's `booking.validate` reports
 * ("Three sides in a Singles match: it takes 2"). A warning never stops a rating; whether an error
 * blocks a booking is the caller's call.
 *
 * Design: docs/design/match-rating.md#warnings.
 */

import { isBefore, type GameDate } from '../../../core/date';
import type { PersonId, PromotionId } from '../../../core/ids';
import type { Catalogs } from '../../../model/catalogs';
import { promotionStatusKey } from '../../../model/entities/employment';
import type { Person, PersonStatus } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { SegmentRatingInput, SegmentWarning } from './types';

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
function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "2", or "2 to 4". */
function rangeText(range: { readonly min: number; readonly max: number }): string {
  return range.min === range.max
    ? String(range.min)
    : `${String(range.min)} to ${String(range.max)}`;
}

function outside(count: number, range: { readonly min: number; readonly max: number }): boolean {
  return count < range.min || count > range.max;
}

/** "a Singles match", "an Endurance Match". */
function matchPhrase(name: string): string {
  const article = /^[aeiou]/i.test(name) ? 'an' : 'a';
  return /match$/i.test(name) ? `${article} ${name}` : `${article} ${name} match`;
}

/** "a Promo", "an Interview". */
function anglePhrase(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** "Side 2" for stored side 1. */
function sideName(side: number): string {
  return `Side ${String(side + 1)}`;
}

const INACTIVE_TEXT: Readonly<Partial<Record<PersonStatus, string>>> = {
  retired: 'is retired',
  deceased: 'has died',
  outOfBusiness: 'has left the business',
  hiatus: 'is on hiatus',
};

/** The ring name each person uses with the promotion, else their default ring name. */
function namerFor(read: GameWorldView, promotionId: PromotionId): (person: Person) => string {
  const ringNames = new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
      .map((employment) => [employment.personId, employment.ringName]),
  );
  return (person) => ringNames.get(person.id) ?? person.defaultRingName;
}

/** The count checks: sides, people per side and equal sides for a match, speakers for an angle. */
function countWarnings(
  input: SegmentRatingInput,
  catalogs: DeepReadonly<Catalogs>,
): SegmentWarning[] {
  const warnings: SegmentWarning[] = [];
  if (input.kind === 'angle') {
    const angleType = Object.hasOwn(catalogs.angleTypes ?? {}, input.typeKey)
      ? catalogs.angleTypes?.[input.typeKey]
      : undefined;
    if (angleType === undefined) {
      return warnings;
    }
    const speakers = input.sides.reduce((total, side) => total + side.personIds.length, 0);
    if (outside(speakers, angleType.speakers)) {
      warnings.push({
        code: 'speakerCount',
        severity: 'warning',
        message: `${countWord(speakers)} ${plural(speakers, 'speaker', 'speakers')} in ${anglePhrase(angleType.name)}: it takes ${rangeText(angleType.speakers)}`,
      });
    }
    return warnings;
  }

  const matchType = Object.hasOwn(catalogs.matchTypes ?? {}, input.typeKey)
    ? catalogs.matchTypes?.[input.typeKey]
    : undefined;
  if (matchType === undefined) {
    return warnings;
  }
  const sideCount = input.sides.length;
  if (outside(sideCount, matchType.sides)) {
    warnings.push({
      code: 'sideCount',
      severity: 'error',
      message: `${countWord(sideCount)} ${plural(sideCount, 'side', 'sides')} in ${matchPhrase(matchType.name)}: it takes ${rangeText(matchType.sides)}`,
    });
  }
  for (const side of input.sides) {
    const size = side.personIds.length;
    if (outside(size, matchType.sideSize)) {
      warnings.push({
        code: 'sideSize',
        severity: 'error',
        side: side.side,
        message: `${sideName(side.side)} has ${String(size)} ${plural(size, 'person', 'people')}: ${matchType.name} takes ${rangeText(matchType.sideSize)} a side`,
      });
    }
  }
  // A side of the wrong size already says what is wrong; uneven sides are only worth a line when
  // every side's size is allowed on its own.
  const sizeWarned = warnings.some((warning) => warning.code === 'sideSize');
  const sizes = input.sides.map((side) => side.personIds.length);
  if (matchType.equalSides && !sizeWarned && new Set(sizes).size > 1) {
    warnings.push({
      code: 'unequalSides',
      severity: 'warning',
      message: `The sides are uneven (${sizes.map(String).join(' against ')}): ${matchType.name} takes equal sides`,
    });
  }
  return warnings;
}

/** Someone booked twice: on two sides, or twice on one. */
function duplicateWarnings(
  input: SegmentRatingInput,
  read: GameWorldView,
  nameOf: (person: Person) => string,
): SegmentWarning[] {
  const sidesByPerson = new Map<PersonId, number[]>();
  for (const side of input.sides) {
    for (const personId of side.personIds) {
      sidesByPerson.set(personId, [...(sidesByPerson.get(personId) ?? []), side.side]);
    }
  }
  const warnings: SegmentWarning[] = [];
  for (const [personId, sides] of sidesByPerson) {
    if (sides.length < 2) {
      continue;
    }
    const person = read.tables.people.get(personId);
    const name = person === undefined ? personId : nameOf(person);
    const distinct = [...new Set(sides)];
    const first = sides[0] ?? 0;
    let message: string;
    if (distinct.length === 1) {
      message = `${name} is on side ${String(first + 1)} twice`;
    } else if (distinct.length === 2) {
      message = `${name} is on both sides`;
    } else {
      message = `${name} is on ${String(distinct.length)} sides`;
    }
    warnings.push({ code: 'duplicatePerson', severity: 'error', personId, side: first, message });
  }
  return warnings;
}

/** Injured, inactive or not a wrestler. Each person once, on the first side they appear on. */
function personWarnings(
  input: SegmentRatingInput,
  read: GameWorldView,
  date: GameDate,
  nameOf: (person: Person) => string,
): SegmentWarning[] {
  const warnings: SegmentWarning[] = [];
  const seen = new Set<PersonId>();
  for (const side of input.sides) {
    for (const personId of side.personIds) {
      if (seen.has(personId)) {
        continue;
      }
      seen.add(personId);
      const person = read.tables.people.get(personId);
      if (person === undefined) {
        continue;
      }
      const name = nameOf(person);
      const at = { personId, side: side.side };
      const inactive = INACTIVE_TEXT[person.status];
      if (inactive !== undefined) {
        warnings.push({
          code: 'inactive',
          severity: 'error',
          message: `${name} ${inactive}`,
          ...at,
        });
      }
      const { injury } = person;
      if (injury !== null && isBefore(date, injury.expectedReturn)) {
        if (input.kind === 'match') {
          warnings.push({
            code: 'injured',
            severity: 'error',
            message: `${name} is injured until ${injury.expectedReturn}`,
            ...at,
          });
        } else if (!injury.canWorkAngles) {
          warnings.push({
            code: 'injured',
            severity: 'error',
            message: `${name} is injured until ${injury.expectedReturn} and cannot appear on camera`,
            ...at,
          });
        }
      }
      if (input.kind === 'match' && person.style === 'nonWrestler') {
        warnings.push({
          code: 'nonWrestler',
          severity: 'warning',
          message: `${name} is not a wrestler`,
          ...at,
        });
      }
    }
  }
  return warnings;
}

const SEVERITY_RANK: Readonly<Record<SegmentWarning['severity'], number>> = {
  error: 0,
  warning: 1,
};

/**
 * Every booking problem with `input` on `date`, errors first, then by side (warnings about the
 * whole segment before those about one side), then in the order they were found. An unknown type
 * or person is not a warning: `rateSegment` refuses those outright.
 */
export function segmentWarnings(
  input: SegmentRatingInput,
  read: GameWorldView,
  catalogs: DeepReadonly<Catalogs>,
  date: GameDate,
): SegmentWarning[] {
  const nameOf = namerFor(read, input.promotionId);
  const found = [
    ...countWarnings(input, catalogs),
    ...duplicateWarnings(input, read, nameOf),
    ...personWarnings(input, read, date, nameOf),
  ];
  return found
    .map((warning, index) => ({ warning, index }))
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.warning.severity] - SEVERITY_RANK[right.warning.severity] ||
        (left.warning.side ?? -1) - (right.warning.side ?? -1) ||
        left.index - right.index,
    )
    .map(({ warning }) => warning);
}
