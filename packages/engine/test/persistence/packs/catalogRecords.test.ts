// Match and segment catalog records (MTCH1-01): the record schemas, content-key forming, merging
// through add-ons, and the snapshot a new world takes into `meta.catalogs`.
// Design: docs/design/data-packs.md, "Match and segment catalogs".
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import {
  angleTypeContentKey,
  catalogsFromRecords,
  describePackIssues,
  loadWorldFromPacks,
  matchTypeContentKey,
  mergeRecords,
  methodContentKey,
  recordFileSchema,
  recordSchemas,
  resolvePacks,
  type MergedContent,
  type RawPack,
} from '../../../src/persistence/packs';
import { parseIssues } from '../../support/schema-issues';
import { miniWorldPacks, testPack } from '../../support/fixture-packs';

type Fixture = Record<string, unknown>;

const SINGLES: Fixture = {
  key: 'singles',
  name: 'Singles',
  order: 10,
  sides: { min: 2, max: 2 },
  sideSize: { min: 1, max: 1 },
  durationShift: 0,
  styleAffinity: [],
};

const TAG: Fixture = {
  key: 'tag-team',
  name: 'Tag Team',
  shortName: 'Tag',
  order: 20,
  sides: { min: 2, max: 2 },
  sideSize: { min: 2, max: 2 },
  durationShift: 0,
  styleAffinity: [],
};

const PROMO: Fixture = {
  key: 'promo',
  name: 'Promo',
  order: 10,
  defaultBeatKey: 'beat.promo',
  speakers: { min: 1, max: 4 },
  speakerWeights: { mic: 0.6, charisma: 0.3, presence: 0.1 },
};

const PINFALL: Fixture = { key: 'pinfall', name: 'Pinfall', order: 10, changesTitles: true };
const COUNT_OUT: Fixture = { key: 'count-out', name: 'Count-Out', order: 50, changesTitles: false };

describe('match type records', () => {
  it('accept a full record with every optional field', () => {
    expect(
      parseIssues(recordSchemas.matchType, {
        ...SINGLES,
        key: 'battle-royal',
        name: 'Battle Royal',
        shortName: 'Royal',
        sides: { min: 6, max: 30 },
        equalSides: true,
        durationShift: 1,
        workRateFactor: 0.85,
        crowdFactor: 1.05,
        styleAffinity: ['brawler', 'powerhouse'],
        allowsTitles: false,
        hidden: false,
        description: 'A crowded ring.',
      }),
    ).toEqual([]);
  });

  it('report sides.max below sides.min on the max field, with the file path', () => {
    const result = recordFileSchema('matchType').safeParse([
      SINGLES,
      TAG,
      { ...SINGLES, key: 'broken', sides: { min: 3, max: 2 } },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describePackIssues('match-types.json', result.error)).toEqual([
        'match-types.json[2].sides.max: must be at least sides.min',
      ]);
    }
  });

  it('refuse a side size of 0, more than 30 sides and a durationShift of 2', () => {
    expect(
      parseIssues(recordSchemas.matchType, { ...SINGLES, sideSize: { min: 0, max: 1 } }),
    ).toEqual(['sideSize.min: Too small: expected number to be >=1']);
    expect(
      parseIssues(recordSchemas.matchType, { ...SINGLES, sides: { min: 2, max: 31 } }),
    ).toEqual(['sides.max: Too big: expected number to be <=30']);
    expect(parseIssues(recordSchemas.matchType, { ...SINGLES, durationShift: 2 })).toHaveLength(1);
  });

  it('refuse factors outside 0.5-1.5 and a repeated style', () => {
    expect(parseIssues(recordSchemas.matchType, { ...SINGLES, workRateFactor: 1.6 })).toEqual([
      'workRateFactor: Too big: expected number to be <=1.5',
    ]);
    expect(
      parseIssues(recordSchemas.matchType, {
        ...SINGLES,
        styleAffinity: ['technician', 'technician'],
      }),
    ).toEqual(['styleAffinity: Each style may appear only once']);
  });

  it('refuse an unknown field', () => {
    expect(parseIssues(recordSchemas.matchType, { ...SINGLES, minutes: 12 })).toEqual([
      ': Unrecognized key: "minutes"',
    ]);
  });
});

describe('angle type records', () => {
  it('accept a valid record', () => {
    expect(parseIssues(recordSchemas.angleType, PROMO)).toEqual([]);
  });

  it('refuse speaker weights that are all 0', () => {
    expect(
      parseIssues(recordSchemas.angleType, {
        ...PROMO,
        speakerWeights: { mic: 0, charisma: 0, presence: 0 },
      }),
    ).toEqual(['speakerWeights: mic, charisma and presence must not all be 0']);
  });

  it('refuse a default beat outside the beat namespace and more than 12 speakers', () => {
    expect(
      parseIssues(recordSchemas.angleType, { ...PROMO, defaultBeatKey: 'angle.promo' }),
    ).toEqual(['defaultBeatKey: must be a beat content key starting with "beat."']);
    expect(
      parseIssues(recordSchemas.angleType, { ...PROMO, speakers: { min: 1, max: 13 } }),
    ).toEqual(['speakers.max: Too big: expected number to be <=12']);
  });
});

describe('method records', () => {
  it('accept a valid record and refuse an unknown field', () => {
    expect(parseIssues(recordSchemas.method, PINFALL)).toEqual([]);
    expect(parseIssues(recordSchemas.method, { ...PINFALL, shortName: 'Pin' })).toEqual([
      ': Unrecognized key: "shortName"',
    ]);
  });
});

describe('content keys', () => {
  it('put each catalog in its own namespace', () => {
    expect(matchTypeContentKey('singles')).toBe('match.singles');
    expect(angleTypeContentKey('promo')).toBe('angle.promo');
    expect(methodContentKey('pinfall')).toBe('method.pinfall');
  });
});

// ---------------------------------------------------------------------------------------------
// Merging and the snapshot

const CATALOG_BASE = testPack({
  id: 'catalog-base',
  kind: 'base',
  records: {
    matchType: [SINGLES, TAG],
    angleType: [PROMO],
    method: [PINFALL, COUNT_OUT],
  },
});

const CATALOG_ADDON = testPack({
  id: 'catalog-addon',
  dependsOn: [{ id: 'catalog-base', version: '^1.0.0' }],
  records: {
    matchType: [
      { key: 'tag-team', $override: 'patch', hidden: true },
      { ...SINGLES, key: 'sprint', name: 'Sprint', order: 90, durationShift: -1 },
    ],
    angleType: [
      { key: 'promo', $override: 'patch', speakers: { min: 1, max: 2 } },
      {
        ...PROMO,
        key: 'attack',
        name: 'Attack',
        defaultBeatKey: 'beat.attack',
        order: 40,
      },
    ],
    method: [
      { key: 'count-out', $remove: true },
      { key: 'pinfall', $override: 'patch', name: 'Three Count' },
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

describe('merging catalog records', () => {
  const content = merged([CATALOG_BASE, CATALOG_ADDON], ['catalog-addon']);

  it('patches and adds match types through an add-on', () => {
    expect([...content.records.matchType.keys()]).toEqual(['singles', 'sprint', 'tag-team']);
    expect(content.records.matchType.get('tag-team')?.record.hidden).toBe(true);
    expect(content.records.matchType.get('tag-team')?.sourcePackId).toBe('catalog-addon');
  });

  it('patches and adds angle types through an add-on', () => {
    expect([...content.records.angleType.keys()]).toEqual(['attack', 'promo']);
    expect(content.records.angleType.get('promo')?.record.speakers).toEqual({ min: 1, max: 2 });
  });

  it('removes and patches methods through an add-on', () => {
    expect([...content.records.method.keys()]).toEqual(['pinfall']);
    expect(content.records.method.get('pinfall')?.record.name).toBe('Three Count');
  });

  it('rechecks a patched record, so a patch cannot leave sides.max below sides.min', () => {
    const badPatch = testPack({
      id: 'catalog-addon',
      dependsOn: [{ id: 'catalog-base', version: '^1.0.0' }],
      records: { matchType: [{ key: 'singles', $override: 'patch', sides: { min: 3, max: 2 } }] },
    });
    const resolved = resolvePacks([CATALOG_BASE, badPatch], ['catalog-addon']);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const result = mergeRecords(resolved.value);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['matchType', 'singles', 'sides', 'max'], 'must be at least sides.min'],
    ]);
  });

  it('snapshots the merged result, defaults filled, keyed by content key', () => {
    const catalogs = catalogsFromRecords(content.records);
    expect(Object.keys(catalogs.matchTypes ?? {})).toEqual([
      'match.singles',
      'match.sprint',
      'match.tag-team',
    ]);
    expect(catalogs.matchTypes?.[parseContentKey('match.singles')]).toEqual({
      key: 'match.singles',
      name: 'Singles',
      order: 10,
      sides: { min: 2, max: 2 },
      sideSize: { min: 1, max: 1 },
      equalSides: true,
      durationShift: 0,
      workRateFactor: 1,
      crowdFactor: 1,
      styleAffinity: [],
      allowsTitles: true,
      hidden: false,
    });
    expect(catalogs.matchTypes?.[parseContentKey('match.tag-team')]?.hidden).toBe(true);
    expect(Object.keys(catalogs.angleTypes ?? {})).toEqual(['angle.attack', 'angle.promo']);
    expect(catalogs.methods).toEqual({
      'method.pinfall': {
        key: 'method.pinfall',
        name: 'Three Count',
        order: 10,
        changesTitles: true,
        hidden: false,
      },
    });
  });

  it('leaves out a catalog no pack defines', () => {
    expect(catalogsFromRecords(merged(miniWorldPacks(), ['mini-world']).records)).toEqual({});
  });
});

describe('loading a world with catalog packs', () => {
  it('lands the add-on edits in meta.catalogs', () => {
    const loaded = loadWorldFromPacks(
      [...miniWorldPacks(), CATALOG_BASE, CATALOG_ADDON],
      ['mini-world', 'catalog-addon'],
      { seed: 'catalog-seed' },
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const { catalogs } = loaded.value.world.meta;
    expect(catalogs).toEqual(
      catalogsFromRecords(merged([CATALOG_BASE, CATALOG_ADDON], ['catalog-addon']).records),
    );
    expect(loaded.value.library.methods['pinfall']?.name).toBe('Three Count');
    expect(Object.keys(loaded.value.library.matchTypes)).toEqual(['singles', 'sprint', 'tag-team']);
  });

  it('gives a world built without catalog packs an empty catalogs object', () => {
    const loaded = loadWorldFromPacks(miniWorldPacks(), ['mini-world'], { seed: 'catalog-seed' });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.world.meta.catalogs).toEqual({});
    }
  });
});
