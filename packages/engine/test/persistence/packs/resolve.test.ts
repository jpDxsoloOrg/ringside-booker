import { describe, expect, it } from 'vitest';
import { resolvePacks, satisfiesRange, type RawPack } from '../../../src/persistence/packs';
import { miniWorldWithAddonPacks, readFixturePack, testPack } from '../../support/fixture-packs';

function resolvedIds(packs: readonly RawPack[], rootIds: readonly string[]): string[] {
  const result = resolvePacks(packs, rootIds);
  if (!result.ok) {
    throw new Error(`Expected the packs to resolve: ${JSON.stringify(result.issues)}`);
  }
  return result.value.map((pack) => pack.manifest.id);
}

function issueCodes(packs: readonly RawPack[], rootIds: readonly string[]): string[] {
  const result = resolvePacks(packs, rootIds);
  expect(result.ok).toBe(false);
  return result.issues.map((issue) => issue.code);
}

describe('resolvePacks', () => {
  it('puts every pack after its dependencies', () => {
    expect(resolvedIds(miniWorldWithAddonPacks(), ['mini-world', 'mini-addon'])).toEqual([
      'mini-base',
      'mini-world',
      'mini-addon',
    ]);
  });

  it('gives the same order however the packs and roots are shuffled', () => {
    const [base, world, addon] = miniWorldWithAddonPacks();
    if (base === undefined || world === undefined || addon === undefined) {
      throw new Error('fixture packs missing');
    }
    const extraB = testPack({ id: 'b-extra', dependsOn: [{ id: 'mini-base', version: '*' }] });
    const extraA = testPack({ id: 'a-extra', dependsOn: [{ id: 'mini-base', version: '*' }] });
    const expected = ['mini-base', 'a-extra', 'b-extra', 'mini-world', 'mini-addon'];
    const roots = ['mini-addon', 'a-extra', 'b-extra'];

    expect(resolvedIds([base, world, addon, extraA, extraB], roots)).toEqual(expected);
    expect(resolvedIds([extraB, addon, extraA, world, base], [...roots].reverse())).toEqual(
      expected,
    );
    expect(resolvedIds([world, extraA, base, extraB, addon], roots)).toEqual(expected);
  });

  it('leaves out packs no root reaches', () => {
    expect(resolvedIds(miniWorldWithAddonPacks(), ['mini-world'])).toEqual([
      'mini-base',
      'mini-world',
    ]);
  });

  it('reports a missing dependency once', () => {
    const result = resolvePacks([readFixturePack('mini-world')], ['mini-world']);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      severity: 'error',
      code: 'missing-dependency',
      packId: 'mini-world',
      path: ['dependsOn', 0, 'id'],
    });
    expect(result.issues[0]?.message).toContain('mini-base');
  });

  it('reports a root that was not passed in', () => {
    expect(issueCodes(miniWorldWithAddonPacks(), ['no-such-pack'])).toEqual(['missing-dependency']);
  });

  it('reports a dependency outside the asked-for version range once', () => {
    const world = readFixturePack('mini-world');
    const wantsNewBase: RawPack = {
      ...world,
      manifest: {
        ...world.manifest,
        dependsOn: world.manifest.dependsOn.map((dependency) => ({
          ...dependency,
          version: '^2.0.0',
        })),
      },
    };
    const result = resolvePacks([readFixturePack('mini-base'), wantsNewBase], ['mini-world']);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: 'version-mismatch',
      packId: 'mini-world',
      path: ['dependsOn', 0, 'version'],
    });
    expect(result.issues[0]?.message).toContain('1.2.0');
  });

  it('reports a two-pack cycle once, as a loop', () => {
    const first = testPack({ id: 'loop-a', dependsOn: [{ id: 'loop-b', version: '*' }] });
    const second = testPack({ id: 'loop-b', dependsOn: [{ id: 'loop-a', version: '*' }] });
    const result = resolvePacks([second, first], ['loop-b']);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: 'dependency-cycle', packId: 'loop-a' });
    expect(result.issues[0]?.message).toContain('loop-a → loop-b → loop-a');
  });

  it('reports a longer cycle with every pack on it', () => {
    const packs = [
      testPack({ id: 'ring-a', dependsOn: [{ id: 'ring-b', version: '*' }] }),
      testPack({ id: 'ring-b', dependsOn: [{ id: 'ring-c', version: '*' }] }),
      testPack({ id: 'ring-c', dependsOn: [{ id: 'ring-a', version: '*' }] }),
    ];
    const result = resolvePacks(packs, ['ring-a']);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      'Packs depend on each other in a loop: ring-a → ring-b → ring-c → ring-a',
    ]);
  });

  it('reports two packs with the same ID', () => {
    const base = readFixturePack('mini-base');
    expect(issueCodes([base, base], ['mini-base'])).toEqual(['duplicate-pack']);
  });

  it('reports a manifest that does not match the schema instead of throwing', () => {
    const base = readFixturePack('mini-base');
    const broken: RawPack = { ...base, manifest: { ...base.manifest, version: 'one' } };
    const result = resolvePacks([broken], ['mini-base']);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'manifest', packId: 'mini-base', path: ['version'] }),
    );
  });

  it('reports record files that are not an object instead of throwing', () => {
    const base = readFixturePack('mini-base');
    const broken: RawPack = { ...base };
    // Parsed JSON can hold anything; the type cannot, so set it past the type checker.
    Reflect.set(broken, 'files', null);
    const result = resolvePacks([broken], ['mini-base']);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'schema', packId: 'mini-base', path: ['files'] }),
    );
  });
});

describe('satisfiesRange', () => {
  it.each([
    ['1.2.0', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '~1', true],
    ['1.4.2', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2', true],
    ['5.0.0', '*', true],
    ['1.5.0', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.2.9', '<=1.2', true],
    ['1.3.0', '<=1.2', false],
    ['3.1.0', '^1.0.0 || ^3.0.0', true],
    ['1.0.0', '=1.0.0', true],
    ['1.0.0+build.5', '1.0.0', true],
    ['2.0.0-beta.1', '^1.0.0', false],
    ['2.0.0-beta.1', '>=2.0.0-alpha <3.0.0', true],
    ['2.1.0-beta.1', '>=2.0.0-alpha <3.0.0', false],
    ['not-a-version', '*', false],
  ])('%s against %s is %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });
});
