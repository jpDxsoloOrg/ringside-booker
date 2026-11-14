/**
 * Segment warnings: the booking problems the Match lab shows and EVT2's `booking.validate` reports
 * ("Three sides in a Singles match: it takes 2"). A warning never stops a rating; whether an error
 * blocks a booking is the caller's call.
 *
 * Design: docs/design/match-rating.md#warnings.
 */

import type { GameDate } from '../../../core/date';
import type { PersonId, PromotionId } from '../../../core/ids';
import { hasBeatCatalog, type Catalogs } from '../../../model/catalogs';
import { promotionStatusKey, type Employment } from '../../../model/entities/employment';
import type { Person } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { availabilityOf, type AvailabilityStatus } from '../../workers/helpers/availability';
import { defaultBeatsOf } from '../angles/angleRater';
import { angleBeatWarnings } from '../angles/angleWarnings';
import { availabilityText } from '../availabilityText';
import type { DurationClass } from '../slots';
import type { SegmentRatingInput, SegmentWarning, SegmentWarningCode } from './types';

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

/** The warning code for each way WRK1's `availabilityOf` can rule someone out. */
const UNAVAILABLE_CODE: Readonly<
  Record<Exclude<AvailabilityStatus, 'available'>, 'injured' | 'inactive' | 'unavailable'>
> = {
  injured: 'injured',
  retired: 'inactive',
  rehab: 'unavailable',
  personalLeave: 'unavailable',
  suspended: 'unavailable',
  timeOff: 'unavailable',
  notDebuted: 'unavailable',
};

/**
 * The code for someone who cannot work the segment. A talking segment rated by beats (MTCH5-03)
 * uses the `angle.*` codes: `angle.cannotWorkAngles` for an injury that rules out talking
 * segments, `angle.unavailable` for anything else.
 */
function unavailableCode(
  status: Exclude<AvailabilityStatus, 'available'>,
  angleByBeats: boolean,
): SegmentWarningCode {
  if (!angleByBeats) {
    return UNAVAILABLE_CODE[status];
  }
  return status === 'injured' ? 'angle.cannotWorkAngles' : 'angle.unavailable';
}

/** Each person's active contract with the promotion: ring name, and any leave it carries. */
interface Contracts {
  readonly nameOf: (person: Person) => string;
  readonly contractOf: (personId: PersonId) => DeepReadonly<Employment> | null;
}

/** The promotion's active contracts, by person. */
function contractsFor(read: GameWorldView, promotionId: PromotionId): Contracts {
  const contracts = new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
      .map((employment) => [employment.personId, employment]),
  );
  return {
    nameOf: (person) => contracts.get(person.id)?.ringName ?? person.defaultRingName,
    contractOf: (personId) => contracts.get(personId) ?? null,
  };
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
  { nameOf }: Contracts,
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

/**
 * Unavailable on the date or not a wrestler. Each person once, on the first side they appear on.
 * Availability is WRK1's `availabilityOf` against the person's contract with the promotion (a free
 * agent has none): a match needs someone available, a talking segment someone who can work angles,
 * so an injury that allows angles is fine there.
 */
function personWarnings(
  input: SegmentRatingInput,
  read: GameWorldView,
  date: GameDate,
  { nameOf, contractOf }: Contracts,
  byBeats: boolean,
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
      const availability = availabilityOf(person, contractOf(personId), date);
      if (
        availability.status !== 'available' &&
        (input.kind === 'match' || !availability.canWorkAngles)
      ) {
        warnings.push({
          code: unavailableCode(availability.status, input.kind === 'angle' && byBeats),
          severity: 'error',
          message: `${name}: ${availabilityText(availability, date)}`,
          ...at,
        });
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

/** What the beat warnings of a talking segment need (MTCH5-03): the slot's limit comes from them. */
export interface SegmentBeatWarningOptions {
  readonly tunables: EngineTunables;
  readonly durationClass: DurationClass;
}

/** The `angle.*` beat warnings: the input's beats, or the angle type's default beat. */
function beatWarnings(
  input: SegmentRatingInput,
  read: GameWorldView,
  catalogs: DeepReadonly<Catalogs>,
  date: GameDate,
  { nameOf, contractOf }: Contracts,
  options: SegmentBeatWarningOptions,
): SegmentWarning[] {
  const angleType = Object.hasOwn(catalogs.angleTypes ?? {}, input.typeKey)
    ? catalogs.angleTypes?.[input.typeKey]
    : undefined;
  if (angleType === undefined) {
    return [];
  }
  const beats = input.angle?.beats ?? defaultBeatsOf(angleType, input.sides, read);
  return angleBeatWarnings(input, beats, {
    read,
    date,
    tunables: options.tunables,
    durationClass: options.durationClass,
    nameOf: (personId) => {
      const person = read.tables.people.get(personId);
      return person === undefined ? personId : nameOf(person);
    },
    availabilityOf: (personId) => {
      const person = read.tables.people.get(personId);
      return person === undefined ? null : availabilityOf(person, contractOf(personId), date);
    },
  });
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
  beatOptions?: SegmentBeatWarningOptions,
): SegmentWarning[] {
  const contracts = contractsFor(read, input.promotionId);
  const byBeats = input.kind === 'angle' && hasBeatCatalog(read);
  const found = [
    ...countWarnings(input, catalogs),
    ...duplicateWarnings(input, read, contracts),
    ...personWarnings(input, read, date, contracts, byBeats),
    ...(byBeats && beatOptions !== undefined
      ? beatWarnings(input, read, catalogs, date, contracts, beatOptions)
      : []),
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
