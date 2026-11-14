/**
 * The reference check: every `<thing>Key` and `<thing>Keys` field of every merged record must name
 * a record of the right kind.
 *
 * Which fields are references, and what they point at, is declared next to each record schema
 * (`regionReferences`, `employmentReferences`, ...) and collected in `RECORD_REFERENCES`, so a new
 * reference field cannot be added to a schema without the table in the same file being in view.
 * `traitKey`, `gimmickKey`, `defaultBeatKey` and `beatKeys` are not pack references (they name
 * engine traits and catalog entries) and are not in any table. An angle type's beat content keys
 * are checked by `checkBeatKeys` below instead, with the angle templates that use them (MTCH5).
 *
 * A qualified reference (`example-world:harbour-coast`) must also name a pack that defined or
 * overrode that record. Region adjacency is checked both ways: a neighbour that does not list the
 * region back is a warning, and the loader adds the missing side.
 *
 * Format doc: docs/design/data-packs.md, "Keys and references" and "Loading".
 */

import { isPackRef, parseRef, RECORD_KINDS, type RecordKind, type RecordReference } from './keys';
import { packError, packWarning, type PackIssue } from './issues';
import type { MergedRecord, MergedRecords } from './merge';
import { BEAT_CONTENT_PREFIX } from './records/catalogs';
import {
  angleTemplateReferences,
  angleTypeReferences,
  beatReferences,
  finishReferences,
  matchTypeReferences,
  methodReferences,
} from './records/catalogs';
import { continentReferences, countryReferences, regionReferences } from './records/geography';
import { injuryKindReferences } from './records/health';
import {
  bodyArchetypeReferences,
  bodyModifierReferences,
  generationProfileReferences,
  generationRoleReferences,
  generationStyleReferences,
  traitIncidenceReferences,
} from './records/generation';
import {
  countryNameMixReferences,
  nameCultureReferences,
  ringNameWordsReferences,
} from './records/names';
import {
  brandReferences,
  dealReferences,
  eventDefinitionReferences,
  networkReferences,
  promotionReferences,
  titleReferences,
  venueReferences,
} from './records/organisations';
import {
  employmentReferences,
  personReferences,
  teamReferences,
  titleReignReferences,
} from './records/people';

/** Every reference field of every record kind. */
export const RECORD_REFERENCES = {
  continent: continentReferences,
  country: countryReferences,
  region: regionReferences,
  nameCulture: nameCultureReferences,
  countryNameMix: countryNameMixReferences,
  ringNameWords: ringNameWordsReferences,
  generationRole: generationRoleReferences,
  generationStyle: generationStyleReferences,
  bodyArchetype: bodyArchetypeReferences,
  bodyModifier: bodyModifierReferences,
  generationProfile: generationProfileReferences,
  traitIncidence: traitIncidenceReferences,
  injuryKind: injuryKindReferences,
  person: personReferences,
  promotion: promotionReferences,
  brand: brandReferences,
  title: titleReferences,
  venue: venueReferences,
  network: networkReferences,
  eventDefinition: eventDefinitionReferences,
  deal: dealReferences,
  employment: employmentReferences,
  team: teamReferences,
  titleReign: titleReignReferences,
  matchType: matchTypeReferences,
  angleType: angleTypeReferences,
  method: methodReferences,
  finish: finishReferences,
  beat: beatReferences,
  angleTemplate: angleTemplateReferences,
} as const satisfies Record<RecordKind, readonly RecordReference[]>;

/** One reference value found in a record, with where it is. */
export interface FoundReference {
  readonly value: unknown;
  /** The field path inside the record, such as `['coverage', 'regionKeys', 0]`. */
  readonly path: readonly (string | number)[];
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every value at `path` inside `value`. A missing or null field yields nothing (optional and
 * nullable references are allowed to be empty).
 */
export function findReferences(
  value: unknown,
  path: readonly string[],
  at: readonly (string | number)[] = [],
): FoundReference[] {
  const [step, ...rest] = path;
  if (step === undefined) {
    return value === undefined || value === null ? [] : [{ value, path: at }];
  }
  if (step === '[]') {
    if (!Array.isArray(value)) {
      return [];
    }
    const elements: unknown[] = value;
    return elements.flatMap((element, index) => findReferences(element, rest, [...at, index]));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  if (step === '{}') {
    return Object.keys(value).map((key) => ({ value: key, path: [...at, key] }));
  }
  return findReferences(value[step], rest, [...at, step]);
}

/** The merged record of `kind` under `key`, whatever the kind's record type. */
function lookUp(
  records: MergedRecords,
  kind: RecordKind,
  key: string,
): MergedRecord<unknown> | undefined {
  const byKey: ReadonlyMap<string, MergedRecord<unknown>> = records[kind];
  return byKey.get(key);
}

/** The bare key a reference names, or null when the value is not a well-formed reference. */
export function refKey(value: unknown): string | null {
  return isPackRef(value) ? parseRef(value).key : null;
}

interface ReferenceSite {
  readonly kind: RecordKind;
  readonly key: string;
  readonly merged: MergedRecord<unknown>;
  readonly field: string;
  readonly target: RecordKind;
}

function checkOne(
  records: MergedRecords,
  site: ReferenceSite,
  found: FoundReference,
  issues: PackIssue[],
): void {
  const { kind, key, merged, field, target } = site;
  const at = {
    packId: merged.sourcePackId,
    file: merged.file,
    kind,
    recordKey: key,
    path: [kind, key, ...found.path],
  };
  if (!isPackRef(found.value)) {
    issues.push(
      packError({
        ...at,
        code: 'unknown-reference',
        message: `${field} holds ${JSON.stringify(found.value)}, which is not a reference to a record key`,
      }),
    );
    return;
  }
  const { packId, key: targetKey } = parseRef(found.value);
  const targetRecord = lookUp(records, target, targetKey);
  if (targetRecord !== undefined) {
    if (
      packId !== null &&
      packId !== targetRecord.originPackId &&
      packId !== targetRecord.sourcePackId
    ) {
      issues.push(
        packError({
          ...at,
          code: 'unknown-reference',
          message: `${field} names ${found.value}, but pack ${packId} does not define ${target} ${targetKey} (it comes from ${targetRecord.originPackId})`,
        }),
      );
    }
    return;
  }
  const otherKinds = RECORD_KINDS.filter(
    (otherKind) => otherKind !== target && lookUp(records, otherKind, targetKey) !== undefined,
  );
  if (otherKinds.length > 0) {
    issues.push(
      packError({
        ...at,
        code: 'wrong-kind-reference',
        message: `${field} must name a ${target}, but ${targetKey} is a ${otherKinds.join(' and a ')}`,
      }),
    );
    return;
  }
  issues.push(
    packError({
      ...at,
      code: 'unknown-reference',
      message: `${field} names ${target} ${targetKey}, but no loaded pack defines it`,
    }),
  );
}

/** Warns about every region that lists a neighbour which does not list it back. */
function checkNeighbours(records: MergedRecords, issues: PackIssue[]): void {
  for (const [key, merged] of records.region) {
    merged.record.neighbourKeys.forEach((neighbourRef, index) => {
      const neighbourKey = parseRef(neighbourRef).key;
      const neighbour = records.region.get(neighbourKey);
      if (neighbour === undefined) {
        return;
      }
      const listedBack = neighbour.record.neighbourKeys.some(
        (backRef) => parseRef(backRef).key === key,
      );
      if (!listedBack) {
        issues.push(
          packWarning({
            code: 'one-sided-neighbour',
            packId: merged.sourcePackId,
            file: merged.file,
            kind: 'region',
            recordKey: key,
            path: ['region', key, 'neighbourKeys', index],
            message: `Region ${key} lists ${neighbourKey} as a neighbour, but ${neighbourKey} does not list ${key} back; they are loaded as neighbours both ways`,
          }),
        );
      }
    });
  }
}

/** The beat pack key a beat content key names (`beat.brawl` → `brawl`), or null. */
function beatPackKey(contentKey: string): string | null {
  const prefix = `${BEAT_CONTENT_PREFIX}.`;
  return contentKey.startsWith(prefix) ? contentKey.slice(prefix.length) : null;
}

/** An angle type's `beatKeys`, as a set of beat pack keys, or null when it allows every beat. */
function allowedBeats(beatKeys: readonly string[] | undefined): ReadonlySet<string> | null {
  if (beatKeys === undefined) {
    return null;
  }
  return new Set(beatKeys.flatMap((key) => beatPackKey(key) ?? []));
}

/**
 * MTCH5. An angle type's `beatKeys` must name loaded beats, and so must its `defaultBeatKey` once
 * any pack defines beats (packs from before beats existed may leave the beat catalog out). Every
 * beat of an angle template must be allowed by its angle type, and its `groupTwo` must be null
 * exactly when the beat has one group, or name a cast when the beat's second group is required.
 */
function checkBeatKeys(records: MergedRecords, issues: PackIssue[]): void {
  for (const [key, merged] of records.angleType) {
    const { defaultBeatKey, beatKeys } = merged.record;
    const listed: [string, readonly (string | number)[]][] = (beatKeys ?? []).map(
      (beatKey, index) => [beatKey, ['beatKeys', index]],
    );
    if (records.beat.size > 0) {
      listed.unshift([defaultBeatKey, ['defaultBeatKey']]);
    }
    for (const [beatKey, path] of listed) {
      const packKey = beatPackKey(beatKey);
      if (packKey !== null && records.beat.has(packKey)) {
        continue;
      }
      issues.push(
        packError({
          code: 'unknown-reference',
          packId: merged.sourcePackId,
          file: merged.file,
          kind: 'angleType',
          recordKey: key,
          path: ['angleType', key, ...path],
          message: `${String(path[0])} names beat ${beatKey}, but no loaded pack defines it`,
        }),
      );
    }
  }

  for (const [key, merged] of records.angleTemplate) {
    const angleType = records.angleType.get(parseRef(merged.record.angleTypeKey).key);
    const allowed = allowedBeats(angleType?.record.beatKeys);
    merged.record.beats.forEach((templateBeat, index) => {
      const beatKey = parseRef(templateBeat.beatKey).key;
      const beat = records.beat.get(beatKey);
      if (angleType === undefined || beat === undefined) {
        // An unknown angle type or beat is already an unknown-reference error.
        return;
      }
      const at = {
        packId: merged.sourcePackId,
        file: merged.file,
        kind: 'angleTemplate' as const,
        recordKey: key,
      };
      if (allowed !== null && !allowed.has(beatKey)) {
        issues.push(
          packError({
            ...at,
            code: 'beat-not-allowed',
            path: ['angleTemplate', key, 'beats', index, 'beatKey'],
            message: `beat ${beatKey} is not one of the beats angle type ${angleType.record.key} allows`,
          }),
        );
      }
      const second = beat.record.groups[1];
      const problem =
        second === undefined
          ? templateBeat.groupTwo === null
            ? null
            : `beat ${beatKey} has one group, so groupTwo must be null`
          : !second.optional && templateBeat.groupTwo === null
            ? `beat ${beatKey} needs someone in its second group (${second.label})`
            : null;
      if (problem !== null) {
        issues.push(
          packError({
            ...at,
            code: 'schema',
            path: ['angleTemplate', key, 'beats', index, 'groupTwo'],
            message: problem,
          }),
        );
      }
    });
  }
}

/**
 * Checks every reference in the merged records. Returns `unknown-reference` and
 * `wrong-kind-reference` errors and `one-sided-neighbour` warnings, record by record in kind and
 * key order.
 */
export function checkReferences(records: MergedRecords): PackIssue[] {
  const issues: PackIssue[] = [];
  for (const kind of RECORD_KINDS) {
    const references: readonly RecordReference[] = RECORD_REFERENCES[kind];
    if (references.length === 0) {
      continue;
    }
    const byKey: ReadonlyMap<string, MergedRecord<unknown>> = records[kind];
    for (const [key, merged] of byKey) {
      for (const reference of references) {
        const field = reference.path.filter((step) => step !== '[]' && step !== '{}').join('.');
        const site: ReferenceSite = { kind, key, merged, field, target: reference.target };
        for (const found of findReferences(merged.record, reference.path)) {
          checkOne(records, site, found, issues);
        }
      }
    }
  }
  checkNeighbours(records, issues);
  checkBeatKeys(records, issues);
  return issues;
}
