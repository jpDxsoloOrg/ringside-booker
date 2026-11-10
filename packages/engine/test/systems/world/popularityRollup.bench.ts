/**
 * Informational benchmark, not part of `npm test`. Run it with:
 *
 *   npx vitest bench --project engine --run test/systems/world/popularityRollup
 *
 * A list query rolls every person in the world with the fast path. The budget is 50 ms for the
 * default world's 286 people; measured on a development laptop (2026-11) one pass takes about
 * 2 ms, and creating the roller (the population shares) about 0.01 ms. The traced
 * roll-up for one person (about 1 ms) is there for scale: a profile pays it once, a list never.
 * Design: docs/design/geography.md#popularity-roll-up
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';
import {
  createPopularityRoller,
  geographyOf,
  loadWorldFromPacks,
  packManifestSchema,
  popularityRollup,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '@ringside/engine';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

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
  { seed: 'popularity-rollup-bench' },
);
if (!loaded.ok) {
  throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
}
const { world } = loaded.value;
const geography = geographyOf(world);
const people = world.tables.people.values();
const roller = createPopularityRoller(geography);
const [firstPerson] = people;

describe(`popularity roll-up, ${String(people.length)} people`, () => {
  bench('rollValues for every person (the list path)', () => {
    for (const person of people) {
      roller.rollValues(person.regionalPop);
    }
  });

  bench('createPopularityRoller (once per query)', () => {
    createPopularityRoller(geography);
  });

  bench('popularityRollup with traces for one person (the profile path)', () => {
    if (firstPerson !== undefined) {
      popularityRollup(firstPerson.regionalPop, geography);
    }
  });
});
