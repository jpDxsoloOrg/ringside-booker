import { describe, expect, it } from 'vitest';
import {
  PACK_FORMAT_VERSION,
  packManifestSchema,
  SEMVER_RANGE_PATTERN,
} from '../../../src/persistence/packs/manifest';
import {
  isMigrationChain,
  PACK_FORMAT_MIGRATIONS,
  type PackFormatMigration,
} from '../../../src/persistence/packs/migrations';
import { parseIssues } from '../../support/schema-issues';

function worldManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'test-world',
    name: 'Test World',
    version: '1.0.0',
    kind: 'world',
    description: 'A world for the manifest tests.',
    author: 'Tests',
    dependsOn: [{ id: 'base-names', version: '^1.0.0' }],
    startDate: '2026-01-05',
    files: { region: 'geography/regions.json', promotion: 'promotions.json' },
    ...overrides,
  };
}

function withoutField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== field));
}

describe('packManifestSchema', () => {
  it('parses a valid world manifest', () => {
    const result = packManifestSchema.safeParse(worldManifest());
    expect(result.success).toBe(true);
    expect(result.data?.files.region).toBe('geography/regions.json');
  });

  it('parses base and addon manifests without a start date', () => {
    const base = withoutField(worldManifest({ kind: 'base', dependsOn: [] }), 'startDate');
    const addon = withoutField(worldManifest({ kind: 'addon' }), 'startDate');
    expect(parseIssues(packManifestSchema, base)).toEqual([]);
    expect(parseIssues(packManifestSchema, addon)).toEqual([]);
  });

  it('rejects a world pack without startDate', () => {
    expect(parseIssues(packManifestSchema, withoutField(worldManifest(), 'startDate'))).toEqual([
      'startDate: A world pack must set startDate',
    ]);
  });

  it('rejects a startDate on a pack that is not a world', () => {
    expect(parseIssues(packManifestSchema, worldManifest({ kind: 'addon' }))).toEqual([
      'startDate: Only world packs set startDate, not addon packs',
    ]);
  });

  it('rejects the id "My Pack"', () => {
    const issues = parseIssues(packManifestSchema, worldManifest({ id: 'My Pack' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^id: Expected a pack ID/);
  });

  it('rejects ids that are too short, too long or start with a digit', () => {
    for (const id of ['a', `a${'b'.repeat(40)}`, '1pack', 'pack_one']) {
      expect(packManifestSchema.safeParse(worldManifest({ id })).success).toBe(false);
    }
  });

  it('rejects an unknown top-level field instead of ignoring it', () => {
    const issues = parseIssues(packManifestSchema, worldManifest({ dependOn: [] }));
    expect(issues).toEqual([': Unrecognized key: "dependOn"']);
  });

  it('rejects formatVersion 2 with the version message and checks nothing else', () => {
    const issues = parseIssues(
      packManifestSchema,
      worldManifest({ formatVersion: 2, name: '', somethingNew: true }),
    );
    expect(issues).toEqual([
      'formatVersion: pack test-world uses format 2, this build reads up to 1',
    ]);
  });

  it('rejects a missing or nonsense format version', () => {
    expect(
      packManifestSchema.safeParse(withoutField(worldManifest(), 'formatVersion')).success,
    ).toBe(false);
    expect(packManifestSchema.safeParse(worldManifest({ formatVersion: 0 })).success).toBe(false);
    expect(packManifestSchema.safeParse(worldManifest({ formatVersion: 1.5 })).success).toBe(false);
  });

  it('rejects a bad version, an unknown record kind and an unsafe file path', () => {
    expect(packManifestSchema.safeParse(worldManifest({ version: '1.0' })).success).toBe(false);
    expect(
      packManifestSchema.safeParse(worldManifest({ files: { gimmick: 'g.json' } })).success,
    ).toBe(false);
    for (const path of [
      '../people.json',
      '/people.json',
      'people.txt',
      'People.json',
      'a\\b.json',
    ]) {
      expect(packManifestSchema.safeParse(worldManifest({ files: { person: path } })).success).toBe(
        false,
      );
    }
  });

  it('rejects two kinds sharing one file', () => {
    const issues = parseIssues(
      packManifestSchema,
      worldManifest({ files: { region: 'world.json', country: 'world.json' } }),
    );
    expect(issues).toEqual(['files: Each record kind needs its own file']);
  });

  it('rejects repeated and self dependencies', () => {
    const repeated = worldManifest({
      dependsOn: [
        { id: 'base-names', version: '^1.0.0' },
        { id: 'base-names', version: '^2.0.0' },
      ],
    });
    expect(parseIssues(packManifestSchema, repeated)).toEqual([
      'dependsOn: Each dependency may be listed only once',
    ]);
    const self = worldManifest({ dependsOn: [{ id: 'test-world', version: '*' }] });
    expect(parseIssues(packManifestSchema, self)).toEqual([
      'dependsOn.0.id: A pack cannot depend on itself',
    ]);
  });
});

describe('dependency version ranges', () => {
  it.each([
    '^1.0.0',
    '~1.2',
    '>=1.0.0 <2.0.0',
    '1.x',
    '*',
    '1.2.3',
    '^1.0.0 || ^2.0.0',
    '=1.0.0-beta.1',
  ])('accepts %s', (range) => {
    expect(SEMVER_RANGE_PATTERN.test(range)).toBe(true);
  });

  it.each(['', 'latest', '^01.0.0', '1.0.0.0', '>= ', 'v1.0.0', '^1.0.0 ||'])(
    'rejects "%s"',
    (range) => {
      expect(SEMVER_RANGE_PATTERN.test(range)).toBe(false);
    },
  );
});

describe('pack format migrations', () => {
  function migration(from: number, to: number): PackFormatMigration {
    return { from, to, description: `${String(from)} to ${String(to)}`, migrate: (pack) => pack };
  }

  it('the shipped list is one ordered chain ending at the current format', () => {
    expect(isMigrationChain(PACK_FORMAT_MIGRATIONS, PACK_FORMAT_VERSION)).toBe(true);
  });

  it('accepts an empty list only while the current format is 1', () => {
    expect(isMigrationChain([], 1)).toBe(true);
    expect(isMigrationChain([], 2)).toBe(false);
  });

  it('accepts an ordered chain and rejects gaps, skips, disorder and a wrong end', () => {
    expect(isMigrationChain([migration(1, 2), migration(2, 3)], 3)).toBe(true);
    expect(isMigrationChain([migration(2, 3), migration(1, 2)], 3)).toBe(false);
    expect(isMigrationChain([migration(1, 2), migration(3, 4)], 4)).toBe(false);
    expect(isMigrationChain([migration(1, 3)], 3)).toBe(false);
    expect(isMigrationChain([migration(1, 2)], 3)).toBe(false);
    expect(isMigrationChain([migration(2, 3)], 3)).toBe(false);
  });
});
