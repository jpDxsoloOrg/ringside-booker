/**
 * Data packs for loader tests: the fixture packs under `test/fixtures/packs/`, read from disk the
 * way the pack tools will read real ones, plus a quick way to build a small pack inline.
 *
 * The loader itself never reads files; only tests and tools do.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  packManifestSchema,
  RECORD_KINDS,
  type PackKind,
  type PackManifest,
  type RawPack,
  type RecordKind,
} from '../../src/persistence/packs';

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/packs/', import.meta.url));

/** The fixture packs: `mini-base`, `mini-world` and `mini-addon`. */
export type FixturePackId = 'mini-base' | 'mini-world' | 'mini-addon';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a fixture pack: its manifest and every record file the manifest lists. */
export function readFixturePack(packId: FixturePackId): RawPack {
  const manifest = packManifestSchema.parse(readJson(`${FIXTURE_ROOT}${packId}/pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${FIXTURE_ROOT}${packId}/${file}`);
    }
  }
  return { manifest, files };
}

/** `mini-base` and `mini-world`, the smallest playable fixture world. */
export function miniWorldPacks(): RawPack[] {
  return [readFixturePack('mini-base'), readFixturePack('mini-world')];
}

/** All three fixture packs. */
export function miniWorldWithAddonPacks(): RawPack[] {
  return [...miniWorldPacks(), readFixturePack('mini-addon')];
}

export interface TestPackSpec {
  readonly id: string;
  readonly kind?: PackKind;
  readonly version?: string;
  readonly dependsOn?: readonly { readonly id: string; readonly version: string }[];
  readonly startDate?: string;
  /** Record kind → the file's JSON. Each kind is listed in the manifest as `<kind>.json`. */
  readonly records?: Partial<Record<RecordKind, unknown>>;
}

/** Builds a pack inline: an `addon` at version 1.0.0 with no dependencies unless told otherwise. */
export function testPack(spec: TestPackSpec): RawPack {
  const kind = spec.kind ?? 'addon';
  const records = spec.records ?? {};
  const fileList: Partial<Record<RecordKind, string>> = {};
  for (const recordKind of RECORD_KINDS) {
    if (records[recordKind] !== undefined) {
      fileList[recordKind] = `${recordKind.toLowerCase()}.json`;
    }
  }
  const manifest: PackManifest = packManifestSchema.parse({
    formatVersion: 1,
    id: spec.id,
    name: `Test pack ${spec.id}`,
    version: spec.version ?? '1.0.0',
    kind,
    description: '',
    author: 'Ringside Booker tests',
    dependsOn: spec.dependsOn ?? [],
    ...(kind === 'world' ? { startDate: spec.startDate ?? '2026-01-05' } : {}),
    files: fileList,
  });
  return { manifest, files: { ...records } };
}

/** A copy of `pack` with some record files replaced or (with `undefined`) dropped. */
export function withFiles(pack: RawPack, files: Partial<Record<RecordKind, unknown>>): RawPack {
  const manifestFiles: Partial<Record<RecordKind, string>> = {};
  const nextFiles: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const replaced = kind in files;
    const data = replaced ? files[kind] : pack.files[kind];
    const file = pack.manifest.files[kind] ?? `${kind.toLowerCase()}.json`;
    if (data !== undefined) {
      nextFiles[kind] = data;
      manifestFiles[kind] = file;
    } else if (!replaced && pack.manifest.files[kind] !== undefined) {
      manifestFiles[kind] = file;
    }
  }
  return { manifest: { ...pack.manifest, files: manifestFiles }, files: nextFiles };
}

/** The record file of `kind` in `pack`, as an array of plain objects. */
export function recordsOf(pack: RawPack, kind: RecordKind): Record<string, unknown>[] {
  const data = pack.files[kind];
  if (!Array.isArray(data)) {
    throw new Error(`Pack ${pack.manifest.id} has no ${kind} file`);
  }
  const entries: unknown[] = data;
  return entries.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Pack ${pack.manifest.id} has a ${kind} entry that is not an object`);
    }
    return { ...entry };
  });
}
