// The shipped default world with its people (WLD-09): roster, contracts, teams and title history.
// Design: docs/design/default-world.md#the-roster
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT_OK, runValidateWorld } from '@ringside/validate-world/run';
import {
  ageInYears,
  geographyOf,
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type LoadedWorld,
  type Person,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTENT_ROOT = `${REPO_ROOT}content/`;

/** The 5-year age buckets every one of which must hold at least one wrestler: 18-22 to 43-47. */
const AGE_BUCKET_STARTS = [18, 23, 28, 33, 38, 43];
const AGE_BUCKET_YEARS = 5;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
function readContentPack(folder: string): RawPack {
  const packRoot = `${CONTENT_ROOT}${folder}/`;
  const manifest = packManifestSchema.parse(readJson(`${packRoot}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${packRoot}${file}`);
    }
  }
  return { manifest, files };
}

const loaded = loadWorldFromPacks(
  [readContentPack('base'), readContentPack('worlds/default')],
  ['default-world'],
  { seed: 'default-world-people' },
);

function loadedWorld(): LoadedWorld {
  if (!loaded.ok) {
    throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value;
}

function wrestlers(): Person[] {
  const { world } = loadedWorld();
  return world.tables.people.values().filter((person) => person.roles.includes('wrestler'));
}

describe('the default world with its people', () => {
  it('loads with base, with no errors and no warnings', () => {
    expect(loaded.issues).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(loadedWorld().world.tables.people.values().length).toBeGreaterThanOrEqual(240);
  });

  it('passes every validate:world rule under --strict, with no rule skipped', async () => {
    let output = '';
    const code = await runValidateWorld(['content/worlds/default', '--strict'], {
      repoRoot: REPO_ROOT,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        output += text;
      },
    });
    expect(output).toMatch(/OK: 0 errors, 0 warnings\n$/);
    expect(code).toBe(EXIT_OK);
  });

  it('has wrestlers in every 5-year age bucket from 18-22 to 43-47', () => {
    const { startDate } = loadedWorld().world.meta;
    const ages = wrestlers().map((person) => ageInYears(person.birthDate, startDate));
    for (const bucketStart of AGE_BUCKET_STARTS) {
      const inBucket = ages.filter(
        (age) => age >= bucketStart && age < bucketStart + AGE_BUCKET_YEARS,
      );
      expect(
        inBucket.length,
        `${String(bucketStart)}-${String(bucketStart + AGE_BUCKET_YEARS - 1)}`,
      ).toBeGreaterThan(0);
    }
  });

  it('makes at least a quarter of the wrestlers women', () => {
    const all = wrestlers();
    const women = all.filter((person) => person.gender === 'female');
    expect(women.length / all.length).toBeGreaterThanOrEqual(0.25);
  });

  it('builds the flagship roster from at least four home countries', () => {
    const { world } = loadedWorld();
    const geography = geographyOf(world);
    const flagshipId = world.meta.contentKeys['promotion']?.['pro-flagship'];
    const people = world.tables.people;
    const countries = new Set(
      world.tables.employments
        .values()
        .filter(
          (employment) =>
            employment.promotionId === flagshipId &&
            employment.status === 'active' &&
            employment.role === 'wrestler',
        )
        .flatMap((employment) => {
          const person = people.get(employment.personId);
          return person === undefined ? [] : [geography.countryOf(person.birthRegionId).id];
        }),
    );
    expect(countries.size).toBeGreaterThanOrEqual(4);
  });
});
