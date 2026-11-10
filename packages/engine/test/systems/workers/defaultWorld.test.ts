// The workers helpers against the shipped default world: nobody makes a helper throw, and every
// champion may hold the title they hold.
// Design: docs/design/workers.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
import {
  AVAILABILITY_STATUSES,
  availabilityOf,
  gradeOf,
  GRADES,
  isEligibleForTitle,
  mainRoleOf,
  primaryEmploymentOf,
  RATING_ROLES,
  WEIGHT_CLASSES,
  weightClass,
  ageOn,
} from '../../../src/systems/workers';
import { ATTRIBUTE_KEYS } from '../../../src/model/entities/person';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable } from '../../support/trace';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));
const DEFAULT_WORLD_PEOPLE = 286;

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
  { seed: 'default-world-workers' },
);
if (!loaded.ok) {
  throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
}
const { world } = loaded.value;
const today = world.meta.currentDate;
const tunables = createEngineTunables();

describe('the workers helpers on the default world', () => {
  const people = world.tables.people.values();

  it('has the whole shipped roster to check', () => {
    expect(people).toHaveLength(DEFAULT_WORLD_PEOPLE);
  });

  it('gives every person an availability, a weight class, a main role, an age and grades', () => {
    for (const person of people) {
      const employment = primaryEmploymentOf(world, person.id, today);
      const availability = availabilityOf(person, employment, today);
      expect(AVAILABILITY_STATUSES).toContain(availability.status);
      expect(availability.reason).not.toBe('');

      const weight = weightClass({ weightKg: person.weightKg }, { tunables });
      expect(WEIGHT_CLASSES).toContain(weight.value);
      expectSerialisable(weight);

      expect(RATING_ROLES).toContain(mainRoleOf(person, employment));
      expect(ageOn(person, today)).toBeGreaterThanOrEqual(0);
      for (const key of ATTRIBUTE_KEYS) {
        expect(GRADES).toContain(gradeOf(person.attributes[key]).grade);
      }
    }
  });

  it('lets every current champion hold the title they hold', () => {
    const openReigns = world.tables.titleReigns.values().filter((reign) => reign.lostOn === null);
    expect(openReigns.length).toBeGreaterThan(0);
    const refusals: string[] = [];
    for (const reign of openReigns) {
      const title = world.tables.titles.get(reign.titleId);
      if (title === undefined) {
        throw new Error(`Reign ${reign.id} points at a missing title`);
      }
      for (const holderId of reign.holderIds) {
        const holder = world.tables.people.get(holderId);
        if (holder === undefined) {
          throw new Error(`Reign ${reign.id} points at a missing person`);
        }
        for (const reason of isEligibleForTitle(holder, title)) {
          refusals.push(`${holder.defaultRingName} / ${title.name}: ${reason.message}`);
        }
      }
    }
    expect(refusals).toEqual([]);
  });
});
