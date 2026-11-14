/**
 * The beat warnings of a talking segment (MTCH5-03), added to MTCH1's `segmentWarnings` with the
 * same shape and codes namespaced `angle.*`: too many beats for the slot, a beat the angle type
 * does not allow or the catalog does not have, a group with too few or too many people, people who
 * would need to share a side and face each other (booking could not store it), and someone hurt
 * in a physical beat.
 *
 * Design: docs/design/angle-rating.md#warnings.
 */

import type { GameDate } from '../../../core/date';
import type { PersonId } from '../../../core/ids';
import {
  angleTypeOf,
  beatOf,
  isBeatAllowed,
  type AngleTypeDef,
  type BeatDef,
} from '../../../model/catalogs';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import type { Availability } from '../../workers/helpers/availability';
import type { SegmentAngleBeat, SegmentRatingInput, SegmentWarning } from '../rating/types';
import type { DurationClass } from '../slots';
import { assignAngleSides } from './beatGroups';
import { beatLimitMessage, beatLimitOf } from './beatLimit';

/** What the beat warnings read besides the input. */
export interface AngleWarningContext {
  readonly read: GameWorldView;
  readonly date: GameDate;
  readonly tunables: EngineTunables;
  readonly durationClass: DurationClass;
  /** A person's name as the promotion running the show knows them. */
  readonly nameOf: (personId: PersonId) => string;
  /** A person's availability on the show's date, or null for someone the world does not have. */
  readonly availabilityOf: (personId: PersonId) => Availability | null;
}

/** "War of Words" → "War of words": a beat name at the start of a sentence. */
function sentenceName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** "an Interview", "a Promo". */
function anglePhrase(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** "on side B" for a group called "Side B", else "as Targets". */
function groupPhrase(label: string): string {
  return /^side\b/i.test(label) ? `on ${label.replace(/^side/i, 'side')}` : `as ${label}`;
}

function peopleWord(count: number): string {
  return count === 1 ? 'person' : 'people';
}

/** "War of words needs someone on side B", "Brawl needs at least 2 people as Brawlers". */
export function emptyGroupMessage(beatName: string, label: string, minPeople: number): string {
  const who = minPeople <= 1 ? 'someone' : `at least ${String(minPeople)} people`;
  return `${sentenceName(beatName)} needs ${who} ${groupPhrase(label)}`;
}

/** "Interview takes at most 1 person as Host". */
export function groupTooBigMessage(beatName: string, label: string, maxPeople: number): string {
  return `${sentenceName(beatName)} takes at most ${String(maxPeople)} ${peopleWord(maxPeople)} ${groupPhrase(label)}`;
}

/** "X and Y are together in beat 1 but opposed in beat 3; booking can't store that". */
export function sidesConflictMessage(
  nameA: string,
  nameB: string,
  togetherIn: number | null,
  opposedIn: number,
): string {
  const together =
    togetherIn === null
      ? 'must be on the same side'
      : `are together in beat ${String(togetherIn + 1)}`;
  return `${nameA} and ${nameB} ${together} but opposed in beat ${String(opposedIn + 1)}; booking can't store that`;
}

function groupsOf(beat: SegmentAngleBeat): readonly (readonly PersonId[])[] {
  return [beat.groupOne, beat.groupTwo];
}

/** The checks on one beat's groups: too few people (a required group) or too many. */
function groupWarnings(
  beat: SegmentAngleBeat,
  catalogBeat: BeatDef,
  beatIndex: number,
): SegmentWarning[] {
  const warnings: SegmentWarning[] = [];
  const people = groupsOf(beat);
  for (const [index, group] of catalogBeat.groups.entries()) {
    // A one-group beat takes everyone in its group.
    const count =
      catalogBeat.groups.length === 1
        ? beat.groupOne.length + beat.groupTwo.length
        : (people[index]?.length ?? 0);
    if (count < group.minPeople && !(group.optional && count === 0)) {
      warnings.push({
        code: 'angle.emptyGroup',
        severity: 'error',
        beatIndex,
        message: emptyGroupMessage(catalogBeat.name, group.label, group.minPeople),
      });
    } else if (count > group.maxPeople) {
      warnings.push({
        code: 'angle.groupTooBig',
        severity: 'error',
        beatIndex,
        message: groupTooBigMessage(catalogBeat.name, group.label, group.maxPeople),
      });
    }
  }
  return warnings;
}

/** People who would have to share a side and also face each other. */
function sidesWarning(
  beats: readonly SegmentAngleBeat[],
  catalogBeats: readonly (BeatDef | undefined)[],
  nameOf: (personId: PersonId) => string,
): SegmentWarning[] {
  const sided = beats.map((beat, index) => ({
    groupOne: beat.groupOne,
    groupTwo: beat.groupTwo,
    twoGroups: (catalogBeats[index]?.groups.length ?? 1) > 1,
  }));
  const result = assignAngleSides(sided);
  if (!('conflict' in result)) {
    return [];
  }
  const { personA, personB, beatIndex } = result.conflict;
  const together = sided.findIndex(
    (beat) => beat.twoGroups && beat.groupOne.includes(personA) && beat.groupOne.includes(personB),
  );
  return [
    {
      code: 'angle.sidesConflict',
      severity: 'error',
      personId: personA,
      beatIndex,
      message: sidesConflictMessage(
        nameOf(personA),
        nameOf(personB),
        together === -1 ? null : together,
        beatIndex,
      ),
    },
  ];
}

/** Someone hurt but allowed to talk, booked in a physical beat. Each person once. */
function physicalWarnings(
  beats: readonly SegmentAngleBeat[],
  catalogBeats: readonly (BeatDef | undefined)[],
  ctx: AngleWarningContext,
): SegmentWarning[] {
  const warnings: SegmentWarning[] = [];
  const warned = new Set<PersonId>();
  for (const [beatIndex, beat] of beats.entries()) {
    const catalogBeat = catalogBeats[beatIndex];
    if (catalogBeat?.physical !== true) {
      continue;
    }
    for (const personId of [...beat.groupOne, ...beat.groupTwo]) {
      const availability = ctx.availabilityOf(personId);
      if (
        warned.has(personId) ||
        availability?.status !== 'injured' ||
        !availability.canWorkAngles
      ) {
        continue;
      }
      warned.add(personId);
      warnings.push({
        code: 'angle.injuredInPhysicalBeat',
        severity: 'warning',
        personId,
        beatIndex,
        message: `${ctx.nameOf(personId)} is hurt: the ${catalogBeat.name.toLowerCase()} in beat ${String(beatIndex + 1)} is physical`,
      });
    }
  }
  return warnings;
}

/**
 * Every beat warning of a talking segment with `beats`. Nothing for a match or an unknown angle
 * type (MTCH1 refuses those).
 */
export function angleBeatWarnings(
  input: SegmentRatingInput,
  beats: readonly SegmentAngleBeat[],
  ctx: AngleWarningContext,
): SegmentWarning[] {
  if (input.kind !== 'angle') {
    return [];
  }
  const angleType: AngleTypeDef | undefined = angleTypeOf(ctx.read, input.typeKey);
  if (angleType === undefined) {
    return [];
  }
  const warnings: SegmentWarning[] = [];
  const limit = beatLimitOf(ctx.durationClass, ctx.tunables).value;
  if (beats.length > limit) {
    warnings.push({
      code: 'angle.tooManyBeats',
      severity: 'error',
      message: beatLimitMessage(ctx.durationClass, limit),
    });
  }
  const catalogBeats = beats.map((beat) => beatOf(ctx.read, beat.beatKey));
  for (const [beatIndex, beat] of beats.entries()) {
    const catalogBeat = catalogBeats[beatIndex];
    if (catalogBeat === undefined) {
      warnings.push({
        code: 'angle.unknownBeat',
        severity: 'error',
        beatIndex,
        message: `Beat ${String(beatIndex + 1)}: there is no beat ${beat.beatKey}`,
      });
      continue;
    }
    if (!isBeatAllowed(angleType, beat.beatKey)) {
      warnings.push({
        code: 'angle.beatNotAllowed',
        severity: 'error',
        beatIndex,
        message: `${catalogBeat.name} is not part of ${anglePhrase(angleType.name)}`,
      });
    }
    warnings.push(...groupWarnings(beat, catalogBeat, beatIndex));
  }
  warnings.push(...sidesWarning(beats, catalogBeats, ctx.nameOf));
  warnings.push(...physicalWarnings(beats, catalogBeats, ctx));
  return warnings;
}
