/**
 * The shipped `base` pack loaded into a world, for the people generator and seeding tests: the
 * content library, the map, and a helper that builds a person row on that map.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  addYears,
  geographyOf,
  loadWorldFromPacks,
  packManifestSchema,
  parseGameDate,
  RECORD_KINDS,
  type GameDate,
  type Person,
  type RawPack,
  type RecordKind,
  type Region,
} from '@ringside/engine';
import { aPerson } from '../../../support/builders/people';
import type { DeepPartial } from '../../../support/builders/build-row';

const BASE_PACK_ROOT = fileURLToPath(new URL('../../../../../../content/base/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The shipped base pack, read from disk. */
export function readBasePack(): RawPack {
  const manifest = packManifestSchema.parse(readJson(`${BASE_PACK_ROOT}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${BASE_PACK_ROOT}${file}`);
    }
  }
  return { manifest, files };
}

export const WORLD_DATE = parseGameDate('2026-01-05');

/** A fresh world built from the base pack alone (no people), starting on `startDate`. */
export function loadBaseWorld(startDate: GameDate = WORLD_DATE) {
  const loaded = loadWorldFromPacks([readBasePack()], ['base'], {
    seed: 'seeding-test',
    startDate,
  });
  if (!loaded.ok) {
    throw new Error(`The base pack did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value;
}

export const BASE = loadBaseWorld();
export const BASE_LIBRARY = BASE.library;
export const GEOGRAPHY = geographyOf(BASE.world);

/** The base map's region with this pack key's name, such as `Texas`. */
export function regionNamed(name: string): Region {
  const region = GEOGRAPHY.regions.find((row) => row.name === name);
  if (region === undefined) {
    throw new Error(`The base map has no region called ${name}`);
  }
  return region;
}

/**
 * A person row aged `age` whole years on `worldDate` (birthday `daysPastBirthday` days ago), based
 * in `region`, with any other field overridden.
 */
export function personAged(
  age: number,
  overrides: DeepPartial<Person> = {},
  options: {
    readonly worldDate?: GameDate;
    readonly region?: Region;
    readonly daysPastBirthday?: number;
  } = {},
): Person {
  const worldDate = options.worldDate ?? WORLD_DATE;
  const region = options.region ?? regionNamed('Texas');
  const birthDate = addDays(addYears(worldDate, -age), -(options.daysPastBirthday ?? 100));
  return aPerson({
    birthDate,
    birthRegionId: region.id,
    basedInRegionId: region.id,
    ...overrides,
  });
}
