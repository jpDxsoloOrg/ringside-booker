/**
 * The beat checks (MTCH5): the beat catalog fits the angle types, and every stored angle's beats
 * fit the catalog.
 *
 * `checkBeatCatalog` (on the catalogs alone):
 * - every angle type's `defaultBeatKey` names a beat (`catalog.unknownDefaultBeat`) and is in its
 *   `beatKeys` when it lists them (`catalog.defaultBeatNotAllowed`);
 * - every key in `beatKeys` names a beat (`catalog.unknownBeat`).
 *
 * `checkSegmentBeats` (on stored angles), for every beat of every angle:
 * - `beatKey` names a beat (`segments.unknownBeat`) the angle type allows
 *   (`segments.beatNotAllowed`);
 * - its people are participants of the segment (`segments.beatPersonNotParticipant`);
 * - split into groups by participant side (`beatGroupsOf`), each group's size is within the
 *   group's `minPeople..maxPeople`, and a required group is not empty
 *   (`segments.beatGroupSize`, `segments.beatGroupEmpty`).
 *
 * A world without a beat catalog (a save from before beats, or a world built without packs) is not
 * checked. Nothing throws; each problem is an error naming the segment or the catalog entry and
 * the field. validate:world runs both as its `angle-beats` rule.
 *
 * Design: docs/design/angle-rating.md.
 */

import type { PersonId } from '../../../core/ids';
import {
  angleTypeOf,
  beatOf,
  hasBeatCatalog,
  isBeatAllowed,
  type AngleTypeDef,
  type BeatDef,
  type Catalogs,
} from '../../../model/catalogs';
import type { IntegrityIssue } from '../../../model/integrity';
import { isMatch, type AngleSegment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { beatGroupsOf } from '../angles/beatGroups';

/** Issue codes these checks report. */
export const BEAT_ISSUE_CODES = {
  unknownDefaultBeat: 'catalog.unknownDefaultBeat',
  defaultBeatNotAllowed: 'catalog.defaultBeatNotAllowed',
  unknownCatalogBeat: 'catalog.unknownBeat',
  unknownBeat: 'segments.unknownBeat',
  beatNotAllowed: 'segments.beatNotAllowed',
  beatPersonNotParticipant: 'segments.beatPersonNotParticipant',
  beatGroupSize: 'segments.beatGroupSize',
  beatGroupEmpty: 'segments.beatGroupEmpty',
} as const;

const CODES = BEAT_ISSUE_CODES;

/** A problem with the beat catalog, on one angle type. */
export interface BeatCatalogIssue {
  readonly code: string;
  /** The angle type's content key. */
  readonly key: string;
  /** The field inside the angle type, such as `beatKeys[2]`. */
  readonly path: string;
  readonly message: string;
}

function hasBeat(catalogs: Catalogs, key: string): boolean {
  return catalogs.beats !== undefined && Object.hasOwn(catalogs.beats, key);
}

function checkAngleType(catalogs: Catalogs, angleType: AngleTypeDef): BeatCatalogIssue[] {
  const issues: BeatCatalogIssue[] = [];
  const { key, defaultBeatKey, beatKeys } = angleType;
  if (!hasBeat(catalogs, defaultBeatKey)) {
    issues.push({
      code: CODES.unknownDefaultBeat,
      key,
      path: 'defaultBeatKey',
      message: `angle type ${key}: defaultBeatKey ${defaultBeatKey} is not a beat in the catalog`,
    });
  } else if (!isBeatAllowed(angleType, defaultBeatKey)) {
    issues.push({
      code: CODES.defaultBeatNotAllowed,
      key,
      path: 'beatKeys',
      message: `angle type ${key}: beatKeys leaves out its default beat ${defaultBeatKey}`,
    });
  }
  (beatKeys ?? []).forEach((beatKey, index) => {
    if (!hasBeat(catalogs, beatKey)) {
      issues.push({
        code: CODES.unknownCatalogBeat,
        key,
        path: `beatKeys[${String(index)}]`,
        message: `angle type ${key}: beatKeys lists ${beatKey}, which is not a beat in the catalog`,
      });
    }
  });
  return issues;
}

/** Every problem between the angle types and the beat catalog. Empty without a beat catalog. */
export function checkBeatCatalog(catalogs: Catalogs): BeatCatalogIssue[] {
  if (catalogs.beats === undefined) {
    return [];
  }
  return Object.values(catalogs.angleTypes ?? {})
    .sort((left, right) => left.key.localeCompare(right.key, 'en'))
    .flatMap((angleType) => checkAngleType(catalogs, angleType));
}

function issue(
  segment: DeepReadonly<AngleSegment>,
  code: string,
  path: string,
  message: string,
): IntegrityIssue {
  return {
    code,
    table: 'segments',
    id: segment.id,
    path,
    message: `segments ${segment.id}: ${message}`,
  };
}

function checkGroups(
  segment: DeepReadonly<AngleSegment>,
  beat: BeatDef,
  people: { readonly groupOne: readonly PersonId[]; readonly groupTwo: readonly PersonId[] },
  path: string,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const sizes = [people.groupOne.length, people.groupTwo.length];
  beat.groups.forEach((group, index) => {
    const size = sizes[index] ?? 0;
    if (size === 0) {
      if (!group.optional) {
        issues.push(
          issue(
            segment,
            CODES.beatGroupEmpty,
            path,
            `${beat.key} needs someone in its ${group.label} group`,
          ),
        );
      }
      return;
    }
    if (size < group.minPeople || size > group.maxPeople) {
      issues.push(
        issue(
          segment,
          CODES.beatGroupSize,
          path,
          `${beat.key}'s ${group.label} group has ${String(size)} people; it takes ${String(group.minPeople)} to ${String(group.maxPeople)}`,
        ),
      );
    }
  });
  return issues;
}

function checkAngle(read: GameWorldView, segment: DeepReadonly<AngleSegment>): IntegrityIssue[] {
  const sides = new Map<PersonId, number>();
  for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
    sides.set(participant.personId, participant.side);
  }
  const angleType = angleTypeOf(read, segment.angle.angleTypeKey);
  const issues: IntegrityIssue[] = [];
  segment.angle.beats.forEach((stored, index) => {
    const path = `angle.beats.${String(index)}`;
    const beat = beatOf(read, stored.beatKey);
    if (beat === undefined) {
      issues.push(
        issue(
          segment,
          CODES.unknownBeat,
          `${path}.beatKey`,
          `${path}.beatKey ${stored.beatKey} is not a beat in this world's catalog`,
        ),
      );
      return;
    }
    if (angleType !== undefined && !isBeatAllowed(angleType, beat.key)) {
      issues.push(
        issue(
          segment,
          CODES.beatNotAllowed,
          `${path}.beatKey`,
          `beat ${beat.key} is not one of the beats angle type ${angleType.key} allows`,
        ),
      );
    }
    const outsiders = stored.personIds.filter((personId) => !sides.has(personId));
    if (outsiders.length > 0) {
      issues.push(
        issue(
          segment,
          CODES.beatPersonNotParticipant,
          `${path}.personIds`,
          `${outsiders.join(', ')} ${outsiders.length === 1 ? 'is' : 'are'} in ${beat.key} but not a participant of the segment`,
        ),
      );
    }
    const groups = beatGroupsOf(stored, beat, (personId) => sides.get(personId));
    issues.push(...checkGroups(segment, beat, groups, `${path}.personIds`));
  });
  return issues;
}

/**
 * Every problem with a stored angle's beats, in segment ID order. Empty when the world holds no
 * beat catalog.
 */
export function checkSegmentBeats(read: GameWorldView): IntegrityIssue[] {
  if (!hasBeatCatalog(read)) {
    return [];
  }
  // values() lists rows in ID order.
  return read.tables.segments
    .values()
    .flatMap((segment) => (isMatch(segment) ? [] : checkAngle(read, segment)));
}
