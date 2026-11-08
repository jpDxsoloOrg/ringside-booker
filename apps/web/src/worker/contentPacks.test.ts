import { describe, expect, it, vi } from 'vitest';
import { createContentPackSource, loadBundledContentPacks, readContentPacks } from './contentPacks';
import type { ContentModules } from './contentPacks';

const BASE_MANIFEST = {
  formatVersion: 1,
  id: 'tiny-base',
  name: 'Tiny base',
  version: '1.0.0',
  kind: 'base',
  description: '',
  author: 'Tests',
  dependsOn: [],
  files: { continent: 'geography/continents.json' },
};

const WORLD_MANIFEST = {
  formatVersion: 1,
  id: 'tiny-world',
  name: 'Tiny world',
  version: '1.0.0',
  kind: 'world',
  description: '',
  author: 'Tests',
  dependsOn: [{ id: 'tiny-base', version: '^1.0.0' }],
  startDate: '2027-01-04',
  files: { promotion: 'promotions.json' },
};

const CONTINENTS = [{ key: 'tiny-continent', name: 'Tiny continent' }];
const PROMOTIONS = [{ key: 'tiny-promotion' }];

/** A lazy module for `value`, counted so a test can see which files were fetched. */
function lazy(value: unknown, fetched: string[], path: string): () => Promise<unknown> {
  return () => {
    fetched.push(path);
    return Promise.resolve(value);
  };
}

function tinyModules(fetched: string[] = []): Record<string, () => Promise<unknown>> {
  const entries: [string, unknown][] = [
    ['/content/base/pack.json', BASE_MANIFEST],
    ['/content/base/geography/continents.json', CONTINENTS],
    ['/content/worlds/tiny/pack.json', WORLD_MANIFEST],
    ['/content/worlds/tiny/promotions.json', PROMOTIONS],
    // A build input that sits beside the pack but is not listed in its manifest.
    ['/content/worlds/tiny/roster.spec.json', { notAPackFile: true }],
  ];
  return Object.fromEntries(entries.map(([path, value]) => [path, lazy(value, fetched, path)]));
}

describe('readContentPacks', () => {
  it('groups files by pack folder and loads only what each manifest lists', async () => {
    const fetched: string[] = [];
    const { packs, issues } = await readContentPacks(tinyModules(fetched));

    expect(issues).toEqual([]);
    expect(packs.map((pack) => pack.manifest.id)).toEqual(['tiny-base', 'tiny-world']);
    expect(packs[0]?.files).toEqual({ continent: CONTINENTS });
    expect(packs[1]?.files).toEqual({ promotion: PROMOTIONS });
    expect(fetched).not.toContain('/content/worlds/tiny/roster.spec.json');
  });

  it('leaves out a pack whose listed file was not bundled, with a missing-file issue', async () => {
    const modules = tinyModules();
    delete modules['/content/worlds/tiny/promotions.json'];
    const { packs, issues } = await readContentPacks(modules);

    expect(packs.map((pack) => pack.manifest.id)).toEqual(['tiny-base']);
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'missing-file',
        packId: 'tiny-world',
        file: 'promotions.json',
        kind: 'promotion',
      }),
    ]);
  });

  it('reports a manifest that fails its schema and keeps the other packs', async () => {
    const modules: ContentModules = {
      ...tinyModules(),
      '/content/broken/pack.json': () => Promise.resolve({ id: 'broken' }),
    };
    const { packs, issues } = await readContentPacks(modules);

    expect(packs.map((pack) => pack.manifest.id)).toEqual(['tiny-base', 'tiny-world']);
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest', packId: 'broken' }),
    ]);
  });

  it('reports a file that fails to load instead of throwing', async () => {
    const modules: ContentModules = {
      ...tinyModules(),
      '/content/worlds/tiny/promotions.json': () => Promise.reject(new Error('network down')),
    };
    const { issues } = await readContentPacks(modules);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('network down');
  });
});

describe('createContentPackSource', () => {
  it('reads the packs once and shares the result', async () => {
    const fetched: string[] = [];
    const load = createContentPackSource(tinyModules(fetched));

    const [first, second] = await Promise.all([load(), load()]);
    const third = await load();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fetched.filter((path) => path.endsWith('pack.json'))).toHaveLength(2);
  });

  it('tries again after a read that threw', async () => {
    const throwing = vi.fn(() => {
      throw new Error('broken bundle');
    });
    const modules = new Proxy<ContentModules>(
      {},
      {
        ownKeys: () => {
          throwing();
          return [];
        },
      },
    );
    const load = createContentPackSource(modules);

    await expect(load()).rejects.toThrow('broken bundle');
    await expect(load()).rejects.toThrow('broken bundle');
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});

describe('the bundled content', () => {
  it('holds the base pack and the default world, and no blocklist text', async () => {
    const { packs, issues } = await loadBundledContentPacks();

    expect(issues).toEqual([]);
    expect(packs.map((pack) => pack.manifest.id).sort()).toEqual(['base', 'default-world']);
    const world = packs.find((pack) => pack.manifest.id === 'default-world');
    expect(world?.manifest.kind).toBe('world');
    expect(Object.keys(world?.files ?? {}).sort()).toEqual(
      Object.keys(world?.manifest.files ?? {}).sort(),
    );
  });
});
