/**
 * Merging packs: every record file of every resolved pack folded into one set of records per kind.
 *
 * `mergeRecords` takes the packs in the order `resolvePacks` returned them and, for each pack:
 *
 * 1. checks that the manifest's `files` and the data passed in agree;
 * 2. parses every element of every file with the kind's entry schema, collecting schema errors
 *    with their full field path;
 * 3. folds the entries into the records so far: a plain record adds a key, `"$override":
 *    "replace"` swaps the record, `"$override": "patch"` shallow-merges the fields listed, and
 *    `"$remove": true` deletes it. Only `world` and `addon` packs may override or remove, and only
 *    records that one of their dependencies defines.
 *
 * Finally every surviving record is parsed again with the kind's full schema, so a patch that
 * leaves a record invalid (a title patched to `retired` without a `retiredOn`) is caught here.
 *
 * Format doc: docs/design/data-packs.md, "Overrides" and "Loading".
 */

import type { z } from 'zod';
import type { GameDate } from '../../core/date';
import type { ContentPackRef } from '../../model/world-meta';
import { continentRecord, countryRecord, regionRecord } from './records/geography';
import { generationProfileRecord, traitIncidenceRecord } from './records/generation';
import { countryNameMixRecord, nameCultureRecord, ringNameWordsRecord } from './records/names';
import {
  brandRecord,
  dealRecord,
  eventDefinitionRecord,
  networkRecord,
  promotionRecord,
  titleRecord,
  venueRecord,
} from './records/organisations';
import { employmentRecord, personRecord, teamRecord, titleReignRecord } from './records/people';
import type { PackRecords, RawPack } from './index';
import { hasErrors, packError, type PackIssue, type Result } from './issues';
import { RECORD_KINDS, type RecordKind } from './keys';

/** A record after merging, with the packs it came from. */
export interface MergedRecord<Record> {
  readonly record: Record;
  /** The last pack that added, replaced or patched the record. */
  readonly sourcePackId: string;
  /** The pack that first added the record. Overrides keep it. */
  readonly originPackId: string;
  /** The file in `sourcePackId` the record (or its last patch) is in. */
  readonly file: string;
}

/** Every merged record, per kind, by key. */
export type MergedRecords = {
  readonly [Kind in RecordKind]: ReadonlyMap<string, MergedRecord<PackRecords[Kind]>>;
};

/** Everything the packs say, merged and checked against the record schemas. */
export interface MergedContent {
  /** The packs merged, in load order. Becomes `WorldMeta.contentPacks`. */
  readonly packs: readonly ContentPackRef[];
  /** The start date of the last `world` pack in load order, or null when none was loaded. */
  readonly startDate: GameDate | null;
  /** The name of the last `world` pack in load order, or null when none was loaded. */
  readonly worldName: string | null;
  readonly records: MergedRecords;
}

type ParseOutcome<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/** Parses a complete record of each kind. A mapped type, so `FULL_PARSERS[kind]` stays typed. */
const FULL_PARSERS: {
  readonly [Kind in RecordKind]: (value: unknown) => ParseOutcome<PackRecords[Kind]>;
} = {
  continent: (value) => continentRecord.full.safeParse(value),
  country: (value) => countryRecord.full.safeParse(value),
  region: (value) => regionRecord.full.safeParse(value),
  nameCulture: (value) => nameCultureRecord.full.safeParse(value),
  countryNameMix: (value) => countryNameMixRecord.full.safeParse(value),
  ringNameWords: (value) => ringNameWordsRecord.full.safeParse(value),
  generationProfile: (value) => generationProfileRecord.full.safeParse(value),
  traitIncidence: (value) => traitIncidenceRecord.full.safeParse(value),
  person: (value) => personRecord.full.safeParse(value),
  promotion: (value) => promotionRecord.full.safeParse(value),
  brand: (value) => brandRecord.full.safeParse(value),
  title: (value) => titleRecord.full.safeParse(value),
  venue: (value) => venueRecord.full.safeParse(value),
  network: (value) => networkRecord.full.safeParse(value),
  eventDefinition: (value) => eventDefinitionRecord.full.safeParse(value),
  deal: (value) => dealRecord.full.safeParse(value),
  employment: (value) => employmentRecord.full.safeParse(value),
  team: (value) => teamRecord.full.safeParse(value),
  titleReign: (value) => titleReignRecord.full.safeParse(value),
};

/** Parses one element of a record file: a full record, a patch or a removal. */
const ENTRY_PARSERS: Readonly<Record<RecordKind, (value: unknown) => ParseOutcome<unknown>>> = {
  continent: (value) => continentRecord.entry.safeParse(value),
  country: (value) => countryRecord.entry.safeParse(value),
  region: (value) => regionRecord.entry.safeParse(value),
  nameCulture: (value) => nameCultureRecord.entry.safeParse(value),
  countryNameMix: (value) => countryNameMixRecord.entry.safeParse(value),
  ringNameWords: (value) => ringNameWordsRecord.entry.safeParse(value),
  generationProfile: (value) => generationProfileRecord.entry.safeParse(value),
  traitIncidence: (value) => traitIncidenceRecord.entry.safeParse(value),
  person: (value) => personRecord.entry.safeParse(value),
  promotion: (value) => promotionRecord.entry.safeParse(value),
  brand: (value) => brandRecord.entry.safeParse(value),
  title: (value) => titleRecord.entry.safeParse(value),
  venue: (value) => venueRecord.entry.safeParse(value),
  network: (value) => networkRecord.entry.safeParse(value),
  eventDefinition: (value) => eventDefinitionRecord.entry.safeParse(value),
  deal: (value) => dealRecord.entry.safeParse(value),
  employment: (value) => employmentRecord.entry.safeParse(value),
  team: (value) => teamRecord.entry.safeParse(value),
  titleReign: (value) => titleReignRecord.entry.safeParse(value),
};

type Fields = Readonly<Record<string, unknown>>;

interface WorkingRecord {
  readonly fields: Fields;
  readonly sourcePackId: string;
  readonly originPackId: string;
  readonly file: string;
}

function isPlainObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutMarkers(entry: Fields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry).filter(([field]) => field !== '$override' && field !== '$remove'),
  );
}

function zodPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)));
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Each pack's dependencies, direct and indirect. Packs come in load order, so deps come first. */
function dependencyClosures(packs: readonly RawPack[]): Map<string, ReadonlySet<string>> {
  const closures = new Map<string, ReadonlySet<string>>();
  for (const pack of packs) {
    const closure = new Set<string>();
    for (const dependency of pack.manifest.dependsOn) {
      closure.add(dependency.id);
      for (const indirect of closures.get(dependency.id) ?? []) {
        closure.add(indirect);
      }
    }
    closures.set(pack.manifest.id, closure);
  }
  return closures;
}

interface FoldContext {
  readonly pack: RawPack;
  readonly kind: RecordKind;
  readonly file: string;
  readonly dependencies: ReadonlySet<string>;
  readonly working: Map<string, WorkingRecord>;
  readonly issues: PackIssue[];
}

/** Applies one parsed entry of a pack file to the records so far. */
function foldEntry(context: FoldContext, entry: Fields, key: string, index: number): void {
  const { pack, kind, file, dependencies, working, issues } = context;
  const packId = pack.manifest.id;
  const at = { packId, file, kind, recordKey: key, path: [kind, key] };
  const isRemove = entry['$remove'] === true;
  const override = entry['$override'];
  const existing = working.get(key);

  if (isRemove || override !== undefined) {
    if (pack.manifest.kind === 'base') {
      issues.push(
        packError({
          ...at,
          code: 'override-not-allowed',
          path: [kind, key, isRemove ? '$remove' : '$override'],
          message: `Pack ${packId} is a base pack; only world and addon packs may override or remove records (entry ${String(index)})`,
        }),
      );
      return;
    }
    if (existing === undefined || !dependencies.has(existing.originPackId)) {
      const definedBy =
        existing === undefined
          ? 'no loaded pack defines it'
          : `it comes from ${existing.originPackId}, which ${packId} does not depend on`;
      issues.push(
        packError({
          ...at,
          code: 'override-target-missing',
          message: `${isRemove ? '$remove' : '$override'} names ${kind} ${key}, but none of the packs ${packId} depends on defines it (${definedBy})`,
        }),
      );
      return;
    }
    if (isRemove) {
      working.delete(key);
      return;
    }
    const fields =
      override === 'patch'
        ? { ...existing.fields, ...withoutMarkers(entry) }
        : withoutMarkers(entry);
    working.set(key, { fields, sourcePackId: packId, originPackId: existing.originPackId, file });
    return;
  }

  if (existing !== undefined) {
    issues.push(
      packError({
        ...at,
        code: 'duplicate-key',
        message: `${kind} ${key} is defined by both ${existing.sourcePackId} and ${packId}; mark the second one with "$override" to change it`,
      }),
    );
    return;
  }
  working.set(key, {
    fields: withoutMarkers(entry),
    sourcePackId: packId,
    originPackId: packId,
    file,
  });
}

/** Parses one record file and folds its entries in. */
function foldFile(context: FoldContext, data: unknown): void {
  const { pack, kind, file, issues } = context;
  const packId = pack.manifest.id;
  if (!Array.isArray(data)) {
    issues.push(
      packError({
        code: 'schema',
        packId,
        file,
        kind,
        path: [kind],
        message: `Expected ${file} to be a JSON array of ${kind} records`,
      }),
    );
    return;
  }
  const entries: unknown[] = data;
  const seenInFile = new Map<string, number>();
  entries.forEach((element, index) => {
    const parsed = ENTRY_PARSERS[kind](element);
    const rawKey: unknown = isPlainObject(element) ? element['key'] : undefined;
    const keyForPath = typeof rawKey === 'string' ? rawKey : index;
    if (!parsed.success) {
      for (const problem of parsed.error.issues) {
        issues.push(
          packError({
            code: 'schema',
            packId,
            file,
            kind,
            ...(typeof rawKey === 'string' ? { recordKey: rawKey } : {}),
            path: [kind, keyForPath, ...zodPath(problem.path)],
            message: problem.message,
          }),
        );
      }
      return;
    }
    const entry: unknown = parsed.data;
    if (!isPlainObject(entry) || typeof entry['key'] !== 'string') {
      return;
    }
    const key = entry['key'];
    const firstIndex = seenInFile.get(key);
    if (firstIndex !== undefined) {
      issues.push(
        packError({
          code: 'duplicate-key',
          packId,
          file,
          kind,
          recordKey: key,
          path: [kind, key],
          message: `${kind} ${key} appears twice in ${file} (entries ${String(firstIndex)} and ${String(index)})`,
        }),
      );
      return;
    }
    seenInFile.set(key, index);
    foldEntry(context, entry, key, index);
  });
}

/** Checks that the manifest's file list and the data passed in name the same kinds. */
function checkFileList(pack: RawPack, issues: PackIssue[]): void {
  const packId = pack.manifest.id;
  for (const kind of RECORD_KINDS) {
    const file = pack.manifest.files[kind];
    const hasData = pack.files[kind] !== undefined;
    if (file !== undefined && !hasData) {
      issues.push(
        packError({
          code: 'missing-file',
          packId,
          file,
          kind,
          path: ['files', kind],
          message: `The manifest lists ${file} for ${kind}, but no data was passed in for it`,
        }),
      );
    }
    if (file === undefined && hasData) {
      issues.push(
        packError({
          code: 'unlisted-file',
          packId,
          kind,
          path: ['files', kind],
          message: `Data was passed in for ${kind}, but the manifest of ${packId} lists no file for it`,
        }),
      );
    }
  }
}

/** Parses each folded record of one kind with the full schema, in key order. */
function finishKind<Kind extends RecordKind>(
  kind: Kind,
  working: ReadonlyMap<string, WorkingRecord>,
  issues: PackIssue[],
): Map<string, MergedRecord<PackRecords[Kind]>> {
  const parse = FULL_PARSERS[kind];
  const merged = new Map<string, MergedRecord<PackRecords[Kind]>>();
  for (const key of [...working.keys()].sort(compareText)) {
    const workingRecord = working.get(key);
    if (workingRecord === undefined) {
      continue;
    }
    const parsed = parse(workingRecord.fields);
    if (!parsed.success) {
      for (const problem of parsed.error.issues) {
        issues.push(
          packError({
            code: 'schema',
            packId: workingRecord.sourcePackId,
            file: workingRecord.file,
            kind,
            recordKey: key,
            path: [kind, key, ...zodPath(problem.path)],
            message: `After merging: ${problem.message}`,
          }),
        );
      }
      continue;
    }
    merged.set(key, {
      record: parsed.data,
      sourcePackId: workingRecord.sourcePackId,
      originPackId: workingRecord.originPackId,
      file: workingRecord.file,
    });
  }
  return merged;
}

/**
 * Folds the record files of `packs` (in the order `resolvePacks` returned) into one record set.
 * Fails with `missing-file`, `unlisted-file`, `schema`, `duplicate-key`, `override-not-allowed` or
 * `override-target-missing` issues.
 */
export function mergeRecords(packs: readonly RawPack[]): Result<MergedContent> {
  const issues: PackIssue[] = [];
  const closures = dependencyClosures(packs);
  const workingByKind = new Map<RecordKind, Map<string, WorkingRecord>>(
    RECORD_KINDS.map((kind) => [kind, new Map<string, WorkingRecord>()]),
  );
  let startDate: GameDate | null = null;
  let worldName: string | null = null;

  for (const pack of packs) {
    checkFileList(pack, issues);
    if (pack.manifest.kind === 'world') {
      startDate = pack.manifest.startDate ?? startDate;
      worldName = pack.manifest.name;
    }
    for (const kind of RECORD_KINDS) {
      const file = pack.manifest.files[kind];
      const data = pack.files[kind];
      const working = workingByKind.get(kind);
      if (file === undefined || data === undefined || working === undefined) {
        continue;
      }
      const dependencies = closures.get(pack.manifest.id) ?? new Set<string>();
      foldFile({ pack, kind, file, dependencies, working, issues }, data);
    }
  }

  const working = (kind: RecordKind): ReadonlyMap<string, WorkingRecord> =>
    workingByKind.get(kind) ?? new Map<string, WorkingRecord>();
  const records: MergedRecords = {
    continent: finishKind('continent', working('continent'), issues),
    country: finishKind('country', working('country'), issues),
    region: finishKind('region', working('region'), issues),
    nameCulture: finishKind('nameCulture', working('nameCulture'), issues),
    countryNameMix: finishKind('countryNameMix', working('countryNameMix'), issues),
    ringNameWords: finishKind('ringNameWords', working('ringNameWords'), issues),
    generationProfile: finishKind('generationProfile', working('generationProfile'), issues),
    traitIncidence: finishKind('traitIncidence', working('traitIncidence'), issues),
    person: finishKind('person', working('person'), issues),
    promotion: finishKind('promotion', working('promotion'), issues),
    brand: finishKind('brand', working('brand'), issues),
    title: finishKind('title', working('title'), issues),
    venue: finishKind('venue', working('venue'), issues),
    network: finishKind('network', working('network'), issues),
    eventDefinition: finishKind('eventDefinition', working('eventDefinition'), issues),
    deal: finishKind('deal', working('deal'), issues),
    employment: finishKind('employment', working('employment'), issues),
    team: finishKind('team', working('team'), issues),
    titleReign: finishKind('titleReign', working('titleReign'), issues),
  };

  if (hasErrors(issues)) {
    return { ok: false, issues };
  }
  const content: MergedContent = {
    packs: packs.map((pack) => ({ id: pack.manifest.id, version: pack.manifest.version })),
    startDate,
    worldName,
    records,
  };
  return { ok: true, value: content, issues };
}
