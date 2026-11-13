// The injury catalog record (WRK6-01): the schema, content-key forming, merging through add-ons,
// the snapshot into `meta.catalogs.injuries`, the readers and a save round trip.
// Design: docs/design/data-packs.md, "Health".
import { describe, expect, it } from 'vitest';
import { injuryCatalogOf, injuryKindOf } from '../../../src/model/catalogs';
import { TABLES } from '../../../src/model/tables';
import { WorldMetaSchema } from '../../../src/model/world-meta';
import {
  describePackIssues,
  INJURY_CONTENT_PREFIX,
  injuryCatalogFromRecords,
  injuryContentKey,
  loadWorldFromPacks,
  mergeRecords,
  recordFileSchema,
  recordSchemas,
  resolvePacks,
  type MergedContent,
  type RawPack,
} from '../../../src/persistence/packs';
import { documentToWorld } from '../../../src/persistence/world-document';
import { miniWorldPacks, testPack } from '../../support/fixture-packs';
import { testSaveDocument } from '../../support/saves';
import { parseIssues } from '../../support/schema-issues';
import { TEST_INJURY_CATALOG } from '../../support/injuries';
import { rosterWorld } from '../../support/worlds';

type Fixture = Record<string, unknown>;

const ANKLE: Fixture = {
  key: 'sprained-ankle',
  label: 'Sprained ankle',
  bodyPart: 'legs',
  minDays: 5,
  maxDays: 28,
  weight: 14,
  canWorkAnglesChance: 0.8,
  severityWeights: { minor: 65, moderate: 28, severe: 7 },
};

const CONCUSSION: Fixture = {
  key: 'concussion',
  label: 'Concussion',
  bodyPart: 'head',
  minDays: 7,
  maxDays: 35,
  weight: 10,
  canWorkAnglesChance: 0.3,
  severityWeights: { minor: 60, moderate: 30, severe: 10 },
  description: 'A hard knock to the head.',
};

const RIBS: Fixture = {
  key: 'cracked-ribs',
  label: 'Cracked ribs',
  bodyPart: 'torso',
  minDays: 21,
  maxDays: 49,
  weight: 8,
  canWorkAnglesChance: 0.6,
  severityWeights: { minor: 60, moderate: 30, severe: 10 },
};

describe('injury kind records', () => {
  it('accept a valid record, with and without a description', () => {
    expect(parseIssues(recordSchemas.injuryKind, ANKLE)).toEqual([]);
    expect(parseIssues(recordSchemas.injuryKind, CONCUSSION)).toEqual([]);
  });

  it('report maxDays below minDays on the maxDays field, with the file path', () => {
    const result = recordFileSchema('injuryKind').safeParse([
      ANKLE,
      CONCUSSION,
      RIBS,
      { ...ANKLE, key: 'broken', minDays: 20, maxDays: 10 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describePackIssues('injuries.json', result.error)).toEqual([
        'injuries.json[3].maxDays: must be at least minDays',
      ]);
    }
  });

  it('refuse severity weights that are all 0', () => {
    expect(
      parseIssues(recordSchemas.injuryKind, {
        ...ANKLE,
        severityWeights: { minor: 0, moderate: 0, severe: 0 },
      }),
    ).toEqual(['severityWeights: minor, moderate and severe must not all be 0']);
  });

  it('refuse an unknown field and a body part the engine does not know', () => {
    expect(parseIssues(recordSchemas.injuryKind, { ...ANKLE, minutes: 12 })).toEqual([
      ': Unrecognized key: "minutes"',
    ]);
    expect(parseIssues(recordSchemas.injuryKind, { ...ANKLE, bodyPart: 'tail' })).toHaveLength(1);
  });

  it('refuse a weight of 0, days past two years and a chance above 1', () => {
    expect(parseIssues(recordSchemas.injuryKind, { ...ANKLE, weight: 0 })).toEqual([
      'weight: Too small: expected number to be >0',
    ]);
    expect(parseIssues(recordSchemas.injuryKind, { ...ANKLE, maxDays: 731 })).toEqual([
      'maxDays: Too big: expected number to be <=730',
    ]);
    expect(parseIssues(recordSchemas.injuryKind, { ...ANKLE, canWorkAnglesChance: 1.5 })).toEqual([
      'canWorkAnglesChance: Too big: expected number to be <=1',
    ]);
  });

  it('form injury content keys', () => {
    expect(INJURY_CONTENT_PREFIX).toBe('injury');
    expect(injuryContentKey('sprained-ankle')).toBe('injury.sprained-ankle');
  });
});

// ---------------------------------------------------------------------------------------------
// Merging, the snapshot and the readers

const INJURY_BASE = testPack({
  id: 'injury-base',
  kind: 'base',
  records: { injuryKind: [ANKLE, CONCUSSION, RIBS] },
});

const INJURY_ADDON = testPack({
  id: 'injury-addon',
  dependsOn: [{ id: 'injury-base', version: '^1.0.0' }],
  records: {
    injuryKind: [
      { key: 'sprained-ankle', $override: 'patch', label: 'Rolled ankle', maxDays: 21 },
      { key: 'cracked-ribs', $remove: true },
      { ...ANKLE, key: 'torn-biceps', label: 'Torn biceps', bodyPart: 'arms', maxDays: 210 },
    ],
  },
});

function merged(packs: readonly RawPack[], rootIds: readonly string[]): MergedContent {
  const resolved = resolvePacks(packs, rootIds);
  if (!resolved.ok) {
    throw new Error(JSON.stringify(resolved.issues));
  }
  const result = mergeRecords(resolved.value);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result.value;
}

describe('merging injury kinds', () => {
  const content = merged([INJURY_BASE, INJURY_ADDON], ['injury-addon']);

  it('patches an injury kind through an add-on', () => {
    const ankle = content.records.injuryKind.get('sprained-ankle');
    expect(ankle?.record.label).toBe('Rolled ankle');
    expect(ankle?.record.maxDays).toBe(21);
    expect(ankle?.record.minDays).toBe(5);
    expect(ankle?.sourcePackId).toBe('injury-addon');
  });

  it('removes and adds injury kinds through an add-on', () => {
    expect([...content.records.injuryKind.keys()].sort()).toEqual([
      'concussion',
      'sprained-ankle',
      'torn-biceps',
    ]);
  });

  it('rechecks a patched record, so a patch cannot leave maxDays below minDays', () => {
    const badPatch = testPack({
      id: 'injury-addon',
      dependsOn: [{ id: 'injury-base', version: '^1.0.0' }],
      records: { injuryKind: [{ key: 'sprained-ankle', $override: 'patch', minDays: 60 }] },
    });
    const resolved = resolvePacks([INJURY_BASE, badPatch], ['injury-addon']);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const result = mergeRecords(resolved.value);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => [issue.packId, issue.path, issue.message])).toEqual([
      [
        'injury-addon',
        ['injuryKind', 'sprained-ankle', 'maxDays'],
        'After merging: must be at least minDays',
      ],
    ]);
  });

  it('snapshots the merged result keyed by content key, in key order', () => {
    const catalog = injuryCatalogFromRecords(content.records);
    expect(Object.keys(catalog ?? {})).toEqual([
      'injury.concussion',
      'injury.sprained-ankle',
      'injury.torn-biceps',
    ]);
    expect(catalog?.['injury.concussion']).toEqual({ ...CONCUSSION, key: 'injury.concussion' });
  });

  it('leaves the catalog out when no pack defines one', () => {
    expect(injuryCatalogFromRecords(merged(miniWorldPacks(), ['mini-world']).records)).toBe(
      undefined,
    );
  });
});

describe('loading a world with an injury catalog', () => {
  const loaded = loadWorldFromPacks(
    [...miniWorldPacks(), INJURY_BASE, INJURY_ADDON],
    ['mini-world', 'injury-addon'],
    { seed: 'injury-seed' },
  );

  it('lands the add-on edits in meta.catalogs.injuries and the library', () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const { world, library } = loaded.value;
    expect(world.meta.catalogs.injuries).toEqual(
      injuryCatalogFromRecords(merged([INJURY_BASE, INJURY_ADDON], ['injury-addon']).records),
    );
    expect(Object.keys(library.injuryKinds).sort()).toEqual([
      'concussion',
      'sprained-ankle',
      'torn-biceps',
    ]);
    expect(injuryCatalogOf(world).map((kind) => kind.key)).toEqual([
      'injury.concussion',
      'injury.sprained-ankle',
      'injury.torn-biceps',
    ]);
    expect(injuryKindOf(world, 'injury.sprained-ankle')?.label).toBe('Rolled ankle');
    expect(injuryKindOf(world, 'injury.cracked-ribs')).toBeUndefined();
    expect(injuryKindOf(world, 'not a key')).toBeUndefined();
  });

  it('gives a world built without an injury pack no injury catalog, and empty readers', () => {
    const plain = loadWorldFromPacks(miniWorldPacks(), ['mini-world'], { seed: 'injury-seed' });
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.value.world.meta.catalogs).toEqual({});
      expect(injuryCatalogOf(plain.value.world)).toEqual([]);
      expect(injuryKindOf(plain.value.world, 'injury.sprained-ankle')).toBeUndefined();
    }
  });
});

describe('the injury catalog in a save', () => {
  it('round-trips unchanged', () => {
    const { world } = rosterWorld(4);
    const rebuilt = documentToWorld(testSaveDocument(world), TABLES);
    expect(rebuilt.meta.catalogs.injuries).toEqual(world.meta.catalogs.injuries);
    expect(injuryCatalogOf(rebuilt)).toEqual(TEST_INJURY_CATALOG);
  });

  it('reads world metadata from before the catalog existed with catalogs defaulting to {}', () => {
    const metaWithout: Record<string, unknown> = { ...rosterWorld(2).world.meta };
    delete metaWithout['catalogs'];
    expect(WorldMetaSchema.parse(metaWithout).catalogs).toEqual({});
  });
});
