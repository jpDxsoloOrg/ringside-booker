/**
 * The shipped name lists and ring name words (WLD-05) never produce a real name: a 5,000-person
 * sample of generated legal names and ring names passes the real-name blocklist check.
 *
 * The sample is fixed (seeded), so a failure always reproduces. When it fails, rename or drop the
 * list entry that formed the real name, and add the real name to the blocklist if it is missing.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadWorldFromPacks,
  NameGenerator,
  packs,
  parseGameDate,
  RngRegistry,
  type Gender,
} from '@ringside/engine';
import { COMMITTED_BLOCKLIST_PATH, findBlockedName, loadBlocklist } from '../src/blocklist';
import { readPacks } from '../src/readPacks';
import { REPO_ROOT } from './helpers';

const SAMPLE_SIZE = 5000;

const GENDERS: readonly Gender[] = ['male', 'female', 'male', 'female', 'nonBinary'];

describe('the shipped name lists', () => {
  it(`produce no blocked names in a ${String(SAMPLE_SIZE)}-person sample`, async () => {
    const read = await readPacks([join(REPO_ROOT, 'content/base')]);
    expect(read.issues).toEqual([]);
    const loaded = loadWorldFromPacks(read.packs, ['base'], {
      seed: 'blocklist-sample',
      startDate: parseGameDate('2026-01-05'),
    });
    if (!loaded.ok) {
      throw new Error(
        `The base pack did not load:\n${loaded.issues.map(packs.formatPackIssue).join('\n')}`,
      );
    }
    const { world, library } = loaded.value;
    const blocklist = await loadBlocklist(
      { path: join(REPO_ROOT, COMMITTED_BLOCKLIST_PATH), displayPath: COMMITTED_BLOCKLIST_PATH },
      [],
    );
    const generator = NameGenerator.forWorld(world, library);
    const rng = new RngRegistry('blocklist-sample');
    const people = rng.stream('worldgen.names.person');
    const rings = rng.stream('worldgen.names.ring');
    const countries = [...world.tables.countries.values()];

    const blocked: string[] = [];
    for (let index = 0; index < SAMPLE_SIZE; index++) {
      const country = countries[index % countries.length];
      if (country === undefined) {
        throw new Error('The base pack has no countries');
      }
      const name = generator.personName(people, {
        countryId: country.id,
        gender: GENDERS[index % GENDERS.length] ?? 'male',
      }).value;
      const ringName = generator.ringName(rings, {
        person: name,
        style: index % 10 === 0 ? 'nonWrestler' : 'allRounder',
      }).value;
      for (const value of [name.display, ringName]) {
        const entry = findBlockedName(value, blocklist);
        if (entry !== null) {
          blocked.push(`${value} (matches "${entry.name}")`);
        }
      }
    }
    expect(blocked).toEqual([]);
  }, 60_000);
});
