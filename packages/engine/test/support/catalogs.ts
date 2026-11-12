/**
 * `TEST_CATALOGS`: the shipped base catalogs (`content/base/catalogs/*.json`) read through the real
 * record schemas and turned into runtime entries the way the loader does, so tests follow the
 * shipped data. `worldBuilder().withCatalogs()` puts them on a test world's metadata.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentKey } from '../../src/core/content-key';
import type { Catalogs } from '../../src/model/catalogs';
import {
  angleTypeRecord,
  finishRecord,
  matchTypeRecord,
  methodRecord,
  toAngleTypeDef,
  toFinishDef,
  toMatchTypeDef,
  toMethodDef,
} from '../../src/persistence/packs/records/catalogs';

// `import.meta.dirname` rather than a file URL: in the web app's jsdom tests the module URL is not
// a file URL.
const CATALOG_ROOT = join(import.meta.dirname, '../../../../content/base/catalogs');

function readRecords(file: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(join(CATALOG_ROOT, file), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`content/base/catalogs/${file} is not a JSON array`);
  }
  const records: unknown[] = parsed;
  return records;
}

/** Records parsed with `parse`, as runtime entries keyed by content key, in pack-key order. */
function catalogFrom<PackRecord extends { readonly key: string }, Def extends { key: ContentKey }>(
  file: string,
  parse: (value: unknown) => PackRecord,
  toDef: (record: PackRecord) => Def,
): Record<string, Def> {
  const records = readRecords(file)
    .map(parse)
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  const catalog: Record<string, Def> = {};
  for (const record of records) {
    const def = toDef(record);
    catalog[def.key] = def;
  }
  return catalog;
}

function readTestCatalogs(): Catalogs {
  return {
    angleTypes: catalogFrom(
      'angle-types.json',
      (value) => angleTypeRecord.full.parse(value),
      toAngleTypeDef,
    ),
    matchTypes: catalogFrom(
      'match-types.json',
      (value) => matchTypeRecord.full.parse(value),
      toMatchTypeDef,
    ),
    methods: catalogFrom('methods.json', (value) => methodRecord.full.parse(value), toMethodDef),
    finishes: catalogFrom('finishes.json', (value) => finishRecord.full.parse(value), toFinishDef),
  };
}

/** The shipped base catalogs as a world's `meta.catalogs` holds them after a new game. */
export const TEST_CATALOGS: Catalogs = readTestCatalogs();
