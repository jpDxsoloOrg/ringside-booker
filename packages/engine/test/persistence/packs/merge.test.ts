import { describe, expect, it } from 'vitest';
import {
  mergeRecords,
  resolvePacks,
  type MergedContent,
  type PackIssue,
  type RawPack,
} from '../../../src/persistence/packs';
import {
  miniWorldPacks,
  miniWorldWithAddonPacks,
  readFixturePack,
  recordsOf,
  testPack,
  withFiles,
} from '../../support/fixture-packs';

function merge(packs: readonly RawPack[], rootIds: readonly string[]) {
  const resolved = resolvePacks(packs, rootIds);
  if (!resolved.ok) {
    throw new Error(`Expected the packs to resolve: ${JSON.stringify(resolved.issues)}`);
  }
  return mergeRecords(resolved.value);
}

function mergedContent(packs: readonly RawPack[], rootIds: readonly string[]): MergedContent {
  const result = merge(packs, rootIds);
  if (!result.ok) {
    throw new Error(`Expected the packs to merge: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function mergeIssues(packs: readonly RawPack[], rootIds: readonly string[]): readonly PackIssue[] {
  const result = merge(packs, rootIds);
  expect(result.ok).toBe(false);
  return result.issues;
}

/** An addon on top of the mini world with the given record files. */
function addon(records: Partial<Record<'promotion' | 'region' | 'person', unknown>>): RawPack {
  return testPack({
    id: 'test-addon',
    dependsOn: [{ id: 'mini-world', version: '^1.0.0' }],
    records,
  });
}

const ADDON_ROOTS = ['mini-world', 'test-addon'];

describe('mergeRecords', () => {
  it('merges the fixture packs and records the pack each record came from', () => {
    const content = mergedContent(miniWorldPacks(), ['mini-world']);
    expect(content.packs).toEqual([
      { id: 'mini-base', version: '1.2.0' },
      { id: 'mini-world', version: '1.0.0' },
    ]);
    expect(content.startDate).toBe('2026-01-05');
    expect(content.worldName).toBe('Mini World');
    expect([...content.records.region.keys()]).toEqual([
      'harbour-coast',
      'north-ridge',
      'vell-lowlands',
    ]);
    expect(content.records.region.get('north-ridge')).toMatchObject({
      sourcePackId: 'mini-base',
      originPackId: 'mini-base',
      file: 'geography/regions.json',
    });
    expect(content.records.person.size).toBe(4);
    expect(content.records.nameCulture.has('cormeric')).toBe(true);
  });

  it('rejects a key added by two packs without $override, naming both packs', () => {
    const world = readFixturePack('mini-world');
    const copiedRegion = recordsOf(readFixturePack('mini-base'), 'region')[0];
    const clashing = withFiles(world, { region: [copiedRegion] });
    const issues = mergeIssues([readFixturePack('mini-base'), clashing], ['mini-world']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'duplicate-key',
      packId: 'mini-world',
      kind: 'region',
      recordKey: 'harbour-coast',
      path: ['region', 'harbour-coast'],
    });
    expect(issues[0]?.message).toContain('mini-base');
    expect(issues[0]?.message).toContain('mini-world');
  });

  it('rejects a key used twice in one file', () => {
    const world = readFixturePack('mini-world');
    const [first] = recordsOf(world, 'brand');
    const issues = mergeIssues(
      [readFixturePack('mini-base'), withFiles(world, { brand: [first, first] })],
      ['mini-world'],
    );
    expect(issues.map((issue) => [issue.code, issue.recordKey])).toEqual([
      ['duplicate-key', 'hcw-friday'],
    ]);
  });

  it('patch changes only the fields it lists', () => {
    const before = mergedContent(miniWorldPacks(), ['mini-world']).records.promotion.get(
      'river-city-wrestling',
    );
    const after = mergedContent(miniWorldWithAddonPacks(), [
      'mini-world',
      'mini-addon',
    ]).records.promotion.get('river-city-wrestling');
    expect(after?.record.cash).toBe(400_000);
    expect({ ...after?.record, cash: before?.record.cash }).toEqual(before?.record);
    expect(after).toMatchObject({ sourcePackId: 'mini-addon', originPackId: 'mini-world' });
  });

  it('replace drops the optional fields it leaves out', () => {
    const original = recordsOf(readFixturePack('mini-world'), 'promotion').find(
      (promotion) => promotion['key'] === 'river-city-wrestling',
    );
    expect(original?.['ownerPersonKey']).toBe('otto-brand');
    const withoutOwner = Object.entries(original ?? {}).filter(
      ([field]) => field !== 'ownerPersonKey',
    );
    const replacement = { ...Object.fromEntries(withoutOwner), $override: 'replace', prestige: 30 };
    const content = mergedContent(
      [...miniWorldPacks(), addon({ promotion: [replacement] })],
      ADDON_ROOTS,
    );
    const replaced = content.records.promotion.get('river-city-wrestling')?.record;
    expect(replaced?.prestige).toBe(30);
    expect(replaced).not.toHaveProperty('ownerPersonKey');
    expect(replaced).not.toHaveProperty('$override');
  });

  it('removes a record with $remove', () => {
    const content = mergedContent(miniWorldWithAddonPacks(), ['mini-world', 'mini-addon']);
    expect(content.records.person.has('sam-reed')).toBe(false);
    expect(content.records.employment.has('sam-reed-rcw')).toBe(false);
    expect(content.packs.map((pack) => pack.id)).toEqual(['mini-base', 'mini-world', 'mini-addon']);
  });

  it('rejects $remove of a key no dependency defines', () => {
    const issues = mergeIssues(
      [...miniWorldPacks(), addon({ person: [{ key: 'nobody', $remove: true }] })],
      ADDON_ROOTS,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'override-target-missing',
      packId: 'test-addon',
      recordKey: 'nobody',
    });
  });

  it('rejects $override of a record from a pack that is not a dependency', () => {
    const sibling = testPack({
      id: 'sibling-addon',
      dependsOn: [{ id: 'mini-base', version: '*' }],
      records: {
        region: [
          {
            key: 'south-bay',
            name: 'South Bay',
            countryKey: 'cormere',
            population: 1000,
            neighbourKeys: [],
          },
        ],
      },
    });
    const patcher = testPack({
      id: 'z-patcher',
      dependsOn: [{ id: 'mini-base', version: '*' }],
      records: { region: [{ key: 'south-bay', $override: 'patch', population: 2000 }] },
    });
    const issues = mergeIssues(
      [readFixturePack('mini-base'), sibling, patcher],
      ['sibling-addon', 'z-patcher'],
    );
    expect(issues.map((issue) => [issue.code, issue.packId])).toEqual([
      ['override-target-missing', 'z-patcher'],
    ]);
    expect(issues[0]?.message).toContain('sibling-addon');
  });

  it('does not let a base pack override or remove', () => {
    const patchingBase = testPack({
      id: 'patching-base',
      kind: 'base',
      dependsOn: [{ id: 'mini-base', version: '*' }],
      records: {
        region: [{ key: 'north-ridge', $override: 'patch', population: 1 }],
        country: [{ key: 'vellmark', $remove: true }],
      },
    });
    const issues = mergeIssues([readFixturePack('mini-base'), patchingBase], ['patching-base']);
    expect(issues.map((issue) => [issue.code, issue.recordKey])).toEqual([
      ['override-not-allowed', 'vellmark'],
      ['override-not-allowed', 'north-ridge'],
    ]);
  });

  it('reports schema errors with the record key and the full field path', () => {
    const world = readFixturePack('mini-world');
    const people = recordsOf(world, 'person');
    const broken = people.map((person) =>
      person['key'] === 'nina-vale' ? { ...person, heightCm: 20 } : person,
    );
    const issues = mergeIssues(
      [readFixturePack('mini-base'), withFiles(world, { person: broken })],
      ['mini-world'],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'schema',
      packId: 'mini-world',
      file: 'people.json',
      kind: 'person',
      recordKey: 'nina-vale',
      path: ['person', 'nina-vale', 'heightCm'],
    });
  });

  it('checks a patched record against the full schema', () => {
    const issues = mergeIssues(
      [
        ...miniWorldPacks(),
        addon({
          promotion: [
            { key: 'harbour-city-wrestling', $override: 'patch', shortName: 'lowercase' },
          ],
        }),
      ],
      ADDON_ROOTS,
    );
    expect(issues.map((issue) => [issue.code, issue.packId, issue.path])).toEqual([
      ['schema', 'test-addon', ['promotion', 'harbour-city-wrestling', 'shortName']],
    ]);
  });

  it('reports a file that is not an array, and a manifest file with no data', () => {
    const world = readFixturePack('mini-world');
    const notAnArray: RawPack = { ...world, files: { ...world.files, brand: { key: 'x' } } };
    const withoutReigns = Object.fromEntries(
      Object.entries(notAnArray.files).filter(([kind]) => kind !== 'titleReign'),
    );
    const missingFile: RawPack = { ...notAnArray, files: withoutReigns };
    const issues = mergeIssues([readFixturePack('mini-base'), missingFile], ['mini-world']);
    expect(issues.map((issue) => [issue.code, issue.kind])).toEqual([
      ['missing-file', 'titleReign'],
      ['schema', 'brand'],
    ]);
  });
});
