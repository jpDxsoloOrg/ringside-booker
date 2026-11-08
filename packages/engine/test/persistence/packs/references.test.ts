import { describe, expect, it } from 'vitest';
import {
  checkReferences,
  findReferences,
  mergeRecords,
  RECORD_KINDS,
  RECORD_REFERENCES,
  recordKinds,
  resolvePacks,
  type MergedRecords,
  type RawPack,
} from '../../../src/persistence/packs';
import {
  miniWorldPacks,
  readFixturePack,
  recordsOf,
  testPack,
  withFiles,
} from '../../support/fixture-packs';

function mergedRecords(packs: readonly RawPack[], rootIds: readonly string[]): MergedRecords {
  const resolved = resolvePacks(packs, rootIds);
  if (!resolved.ok) {
    throw new Error(`Expected the packs to resolve: ${JSON.stringify(resolved.issues)}`);
  }
  const merged = mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error(`Expected the packs to merge: ${JSON.stringify(merged.issues)}`);
  }
  return merged.value.records;
}

/** The mini world with one record file of `mini-world` changed. */
function miniWorldWith(files: Parameters<typeof withFiles>[1]): MergedRecords {
  return mergedRecords(
    [readFixturePack('mini-base'), withFiles(readFixturePack('mini-world'), files)],
    ['mini-world'],
  );
}

describe('checkReferences', () => {
  it('finds nothing wrong with the fixture packs', () => {
    expect(checkReferences(mergedRecords(miniWorldPacks(), ['mini-world']))).toEqual([]);
  });

  it('reports an employment pointing at a missing person', () => {
    const world = readFixturePack('mini-world');
    const [template] = recordsOf(world, 'employment');
    const employments = [
      ...recordsOf(world, 'employment'),
      { ...template, key: 'emp-x', personKey: 'nobody' },
    ];
    const issues = checkReferences(miniWorldWith({ employment: employments }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'unknown-reference',
      packId: 'mini-world',
      file: 'employments.json',
      kind: 'employment',
      recordKey: 'emp-x',
      path: ['employment', 'emp-x', 'personKey'],
    });
  });

  it('reports a homeRegionKey that names a country as a wrong-kind reference', () => {
    const promotions = recordsOf(readFixturePack('mini-world'), 'promotion').map((promotion) =>
      promotion['key'] === 'harbour-city-wrestling'
        ? { ...promotion, homeRegionKey: 'cormere' }
        : promotion,
    );
    const issues = checkReferences(miniWorldWith({ promotion: promotions }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'wrong-kind-reference',
      path: ['promotion', 'harbour-city-wrestling', 'homeRegionKey'],
    });
    expect(issues[0]?.message).toContain('country');
  });

  it('checks the keys of regional popularity and references inside lists', () => {
    const promotions = recordsOf(readFixturePack('mini-world'), 'promotion').map((promotion) =>
      promotion['key'] === 'river-city-wrestling'
        ? { ...promotion, regionalPop: { 'lost-region': 10 } }
        : promotion,
    );
    const issues = checkReferences(
      mergedRecords(
        [
          readFixturePack('mini-base'),
          withFiles(readFixturePack('mini-world'), {
            promotion: promotions,
            team: [
              {
                key: 'odd-pair',
                kind: 'tag',
                name: 'Odd Pair',
                memberKeys: ['jack-marlow', 'ghost'],
                formedOn: '2024-01-01',
              },
            ],
          }),
        ],
        ['mini-world'],
      ),
    );
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['unknown-reference', ['promotion', 'river-city-wrestling', 'regionalPop', 'lost-region']],
      ['unknown-reference', ['team', 'odd-pair', 'memberKeys', 1]],
    ]);
  });

  it('accepts a reference qualified with the pack that defines the record, and no other', () => {
    const people = recordsOf(readFixturePack('mini-world'), 'person').map((person) =>
      person['key'] === 'nina-vale'
        ? {
            ...person,
            birthRegionKey: 'mini-base:north-ridge',
            basedInRegionKey: 'mini-world:north-ridge',
          }
        : person,
    );
    const issues = checkReferences(miniWorldWith({ person: people }));
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['unknown-reference', ['person', 'nina-vale', 'basedInRegionKey']],
    ]);
    expect(issues[0]?.message).toContain('mini-base');
  });

  it('gives only a warning for a one-sided neighbour', () => {
    const neighbourless = testPack({
      id: 'border-addon',
      dependsOn: [{ id: 'mini-base', version: '*' }],
      records: {
        region: [
          {
            key: 'east-marsh',
            name: 'East Marsh',
            countryKey: 'vellmark',
            population: 50_000,
            neighbourKeys: ['vell-lowlands'],
          },
        ],
      },
    });
    const issues = checkReferences(
      mergedRecords([readFixturePack('mini-base'), neighbourless], ['border-addon']),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      code: 'one-sided-neighbour',
      packId: 'border-addon',
      path: ['region', 'east-marsh', 'neighbourKeys', 0],
    });
  });

  it('reports a person an add-on removed while an employment still points at them', () => {
    const removesPersonOnly = withFiles(readFixturePack('mini-addon'), { employment: undefined });
    const issues = checkReferences(
      mergedRecords([...miniWorldPacks(), removesPersonOnly], ['mini-world', 'mini-addon']),
    );
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['unknown-reference', ['employment', 'sam-reed-rcw', 'personKey']],
    ]);
  });
});

describe('RECORD_REFERENCES', () => {
  const NOT_PACK_REFERENCES = new Set(['key', 'traitKey', 'gimmickKey']);

  it.each(RECORD_KINDS)('lists every top-level reference field of %s', (kind) => {
    const fieldNames = Object.keys(recordKinds[kind].fields.shape);
    const referenceFields = fieldNames.filter(
      (field) => /Keys?$/.test(field) && !NOT_PACK_REFERENCES.has(field),
    );
    const listed = new Set(RECORD_REFERENCES[kind].map((reference) => reference.path[0]));
    for (const field of referenceFields) {
      expect(listed, `${kind}.${field}`).toContain(field);
    }
    for (const reference of RECORD_REFERENCES[kind]) {
      expect(fieldNames).toContain(reference.path[0]);
    }
  });
});

describe('findReferences', () => {
  it('walks fields, lists and object keys, skipping missing and null values', () => {
    const record = {
      coverage: { regionKeys: ['a', 'b'] },
      regionalPop: { c: 1 },
      ownerKey: null,
    };
    expect(findReferences(record, ['coverage', 'regionKeys', '[]'])).toEqual([
      { value: 'a', path: ['coverage', 'regionKeys', 0] },
      { value: 'b', path: ['coverage', 'regionKeys', 1] },
    ]);
    expect(findReferences(record, ['regionalPop', '{}'])).toEqual([
      { value: 'c', path: ['regionalPop', 'c'] },
    ]);
    expect(findReferences(record, ['ownerKey'])).toEqual([]);
    expect(findReferences(record, ['missingKey'])).toEqual([]);
  });
});
