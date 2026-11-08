import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate } from '../../../src/core/date';
import { isId, kindOfId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { GameWorld } from '../../../src/model/tables';
import {
  CANONICAL_KIND_ORDER,
  DEFAULT_WORLD_SETTINGS,
  loadWorldFromPacks,
  materialiseWorld,
  mergeRecords,
  resolvePacks,
  TABLE_OF_KIND,
  type LoadedWorld,
  type LoadWorldOptions,
  type MergedContent,
  isRecordKind,
  packManifestSchema,
  type RawPack,
} from '../../../src/persistence/packs';
import {
  miniWorldPacks,
  miniWorldWithAddonPacks,
  readFixturePack,
  testPack,
  withFiles,
} from '../../support/fixture-packs';
import { readExamplePack } from '../../support/pack-example';
import { serialiseWorld } from '../../support/serialise';

const START_DATE = parseGameDate('2026-01-05');
const BASE_ROOTS = ['mini-world'];
const ADDON_ROOTS = ['mini-world', 'mini-addon'];

function load(
  packs: readonly RawPack[],
  rootIds: readonly string[] = BASE_ROOTS,
  opts: Partial<LoadWorldOptions> = {},
): LoadedWorld {
  const result = loadWorldFromPacks(packs, rootIds, { seed: 'mini-seed', ...opts });
  if (!result.ok) {
    throw new Error(`Expected the world to load: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.value;
}

function mergedContent(packs: readonly RawPack[], rootIds: readonly string[]): MergedContent {
  const resolved = resolvePacks(packs, rootIds);
  if (!resolved.ok) {
    throw new Error('Expected the packs to resolve');
  }
  const merged = mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new Error('Expected the packs to merge');
  }
  return merged.value;
}

function entityCounts(world: GameWorld): Record<string, number> {
  return Object.fromEntries(
    Object.entries(world.tables).map(([name, table]) => [name, table.size]),
  );
}

/** The row with this ID; IDs come back from `contentKeys` as plain strings. */
function findRow<Row extends { readonly id: string }>(
  table: { values(): readonly Row[] },
  id: string,
): Row | undefined {
  return table.values().find((row) => row.id === id);
}

function idOf(world: GameWorld, kind: string, key: string): string {
  const id = world.meta.contentKeys[kind]?.[key];
  if (id === undefined) {
    throw new Error(`No ${kind} ${key} in contentKeys`);
  }
  return id;
}

describe('materialiseWorld', () => {
  it('builds the same world twice from the same packs and seed', () => {
    const first = load(miniWorldPacks());
    const second = load(miniWorldPacks());
    expect(serialiseWorld(second.world)).toBe(serialiseWorld(first.world));
    expect(second.rng.toState()).toEqual(first.rng.toState());
  });

  it('does not depend on the order packs are passed in', () => {
    const [base, world, addon] = miniWorldWithAddonPacks();
    if (base === undefined || world === undefined || addon === undefined) {
      throw new Error('fixture packs missing');
    }
    const inOrder = load([base, world, addon], ADDON_ROOTS);
    const shuffled = load([addon, base, world], [...ADDON_ROOTS].reverse());
    expect(serialiseWorld(shuffled.world)).toBe(serialiseWorld(inOrder.world));
  });

  it('gives different IDs but the same entities under another seed', () => {
    const first = load(miniWorldPacks(), BASE_ROOTS, { seed: 'seed-one' });
    const second = load(miniWorldPacks(), BASE_ROOTS, { seed: 'seed-two' });
    expect(entityCounts(second.world)).toEqual(entityCounts(first.world));
    expect(idOf(second.world, 'person', 'jack-marlow')).not.toBe(
      idOf(first.world, 'person', 'jack-marlow'),
    );
    expect(second.world.tables.people.ids()).not.toEqual(first.world.tables.people.ids());
  });

  it('creates one entity per record', () => {
    const { world } = load(miniWorldPacks());
    expect(entityCounts(world)).toMatchObject({
      continents: 1,
      countries: 2,
      regions: 3,
      promotions: 2,
      brands: 1,
      titles: 1,
      titleReigns: 1,
      people: 4,
      employments: 4,
      seasons: 1,
    });
  });

  it('maps every record key to its minted ID in contentKeys', () => {
    const content = mergedContent(miniWorldPacks(), BASE_ROOTS);
    const { world } = load(miniWorldPacks());
    for (const kind of CANONICAL_KIND_ORDER) {
      const keys = [...content.records[kind].keys()];
      const mapped = world.meta.contentKeys[kind] ?? {};
      expect(Object.keys(mapped).sort(), kind).toEqual([...keys].sort());
      const table = world.tables[TABLE_OF_KIND[kind]];
      for (const id of Object.values(mapped)) {
        expect(kindOfId(id)).toBe(kind);
        expect(table.ids()).toContain(id);
      }
    }
    expect(world.meta.contentKeys['nameCulture']).toBeUndefined();
  });

  it('fills the metadata from the packs and the default settings', () => {
    const { world } = load(miniWorldPacks());
    expect(world.meta).toMatchObject({
      worldName: 'Mini World',
      startDate: START_DATE,
      currentDate: START_DATE,
      seed: 'mini-seed',
      settings: DEFAULT_WORLD_SETTINGS,
      players: [],
      contentPacks: [
        { id: 'mini-base', version: '1.2.0' },
        { id: 'mini-world', version: '1.0.0' },
      ],
      daysSimulated: 0,
    });
    expect(DEFAULT_WORLD_SETTINGS).toEqual({
      agingEnabled: true,
      sandbox: false,
      generationLevel: 'low',
      levelPlayingField: false,
      season: { lengthDays: 364 },
      extra: {},
    });
  });

  it('gives every promotion a computer controller and every brand a null one', () => {
    const { world } = load(miniWorldPacks());
    expect(world.tables.promotions.size).toBeGreaterThan(0);
    for (const promotion of world.tables.promotions.values()) {
      expect(promotion.controller).toEqual({ kind: 'computer' });
    }
    expect(world.tables.brands.size).toBeGreaterThan(0);
    for (const brand of world.tables.brands.values()) {
      expect(brand.controller).toBeNull();
    }
  });

  it('creates season 1, active, from the start date for the default length', () => {
    const { world } = load(miniWorldPacks());
    const seasons = world.tables.seasons.values();
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({
      number: 1,
      status: 'active',
      startDate: START_DATE,
      endDate: addDays(START_DATE, 363),
    });
    expect(isId('season', seasons[0]?.id)).toBe(true);
  });

  it('uses the season length and start date it is given', () => {
    const startDate = parseGameDate('2027-03-01');
    const { world } = load(miniWorldPacks(), BASE_ROOTS, {
      startDate,
      settings: { season: { lengthDays: 91 }, sandbox: true },
    });
    expect(world.meta.settings).toMatchObject({ sandbox: true, season: { lengthDays: 91 } });
    expect(world.tables.seasons.values()[0]).toMatchObject({
      startDate,
      endDate: addDays(startDate, 90),
    });
  });

  it('turns keys into IDs, money into cents and fills in defaults', () => {
    const { world } = load(miniWorldPacks());
    const harbourId = idOf(world, 'region', 'harbour-coast');
    const northRidgeId = idOf(world, 'region', 'north-ridge');
    const hcw = findRow(
      world.tables.promotions,
      idOf(world, 'promotion', 'harbour-city-wrestling'),
    );
    expect(hcw).toMatchObject({
      homeRegionId: harbourId,
      regionalPop: { [harbourId]: 41, [northRidgeId]: 12 },
      cash: cents(25_000_000),
      logoRef: null,
      ownerPersonId: null,
      parentPromotionId: null,
    });
    const rcw = findRow(world.tables.promotions, idOf(world, 'promotion', 'river-city-wrestling'));
    expect(rcw?.ownerPersonId).toBe(idOf(world, 'person', 'otto-brand'));

    const jack = findRow(world.tables.employments, idOf(world, 'employment', 'jack-marlow-hcw'));
    expect(jack).toMatchObject({
      personId: idOf(world, 'person', 'jack-marlow'),
      brandId: idOf(world, 'brand', 'hcw-friday'),
      status: 'active',
      offeredOn: jack?.startsOn,
      morale: 0,
      momentum: null,
      leave: null,
    });
    expect(jack?.terms.monthlyWage).toBe(cents(250_000));

    const nina = findRow(world.tables.people, idOf(world, 'person', 'nina-vale'));
    expect(nina).toMatchObject({
      fatigue: 0,
      injury: null,
      restrictions: [],
      masked: false,
      tags: [],
      status: 'active',
      career: { canOwn: false, canBook: false },
    });
  });

  it('inherits wrestling interest and preferred style from the country when a region leaves them out', () => {
    const { world } = load(miniWorldPacks());
    const region = (key: string) => findRow(world.tables.regions, idOf(world, 'region', key));
    expect(region('harbour-coast')).toMatchObject({
      wrestlingInterest: 62,
      preferredStyle: 'traditional',
    });
    expect(region('north-ridge')).toMatchObject({
      wrestlingInterest: 70,
      preferredStyle: 'hardHitting',
    });
    expect(region('vell-lowlands')).toMatchObject({ wrestlingInterest: 48, preferredStyle: null });
  });

  it("takes a reign's holder names from the holder's ring name with the title's promotion", () => {
    const { world } = load(miniWorldPacks());
    const [reign] = world.tables.titleReigns.values();
    expect(reign?.holderIds).toEqual([idOf(world, 'person', 'jack-marlow')]);
    expect(reign?.holderNamesAtTime).toEqual(['The Harbour Hammer']);
  });

  it('applies the add-on patch and removal', () => {
    const { world } = load(miniWorldWithAddonPacks(), ADDON_ROOTS);
    const rcw = findRow(world.tables.promotions, idOf(world, 'promotion', 'river-city-wrestling'));
    expect(rcw?.cash).toBe(cents(40_000_000));
    expect(rcw?.prestige).toBe(22);
    expect(world.meta.contentKeys['person']).not.toHaveProperty('sam-reed');
    expect(world.meta.contentKeys['employment']).not.toHaveProperty('sam-reed-rcw');
    expect(world.tables.people.values().map((person) => person.givenName)).not.toContain('Sam');
    expect(world.tables.people.size).toBe(3);
    expect(world.meta.contentPacks.map((pack) => pack.id)).toEqual([
      'mini-base',
      'mini-world',
      'mini-addon',
    ]);
  });

  it('reports removing a person an employment still references as unknown-reference', () => {
    const removesPersonOnly = withFiles(readFixturePack('mini-addon'), { employment: undefined });
    const result = loadWorldFromPacks([...miniWorldPacks(), removesPersonOnly], ADDON_ROOTS, {
      seed: 'mini-seed',
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-reference',
        recordKey: 'sam-reed-rcw',
        path: ['employment', 'sam-reed-rcw', 'personKey'],
      }),
    ]);
  });

  it('reports an entity-schema failure against the source record and returns no world', () => {
    const content = mergedContent(miniWorldPacks(), BASE_ROOTS);
    const hcw = content.records.promotion.get('harbour-city-wrestling');
    if (hcw === undefined) {
      throw new Error('fixture promotion missing');
    }
    const promotions = new Map(content.records.promotion);
    promotions.set('harbour-city-wrestling', { ...hcw, record: { ...hcw.record, prestige: 150 } });
    const broken: MergedContent = {
      ...content,
      records: { ...content.records, promotion: promotions },
    };
    const result = materialiseWorld(broken, { seed: 'mini-seed', startDate: START_DATE });
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'entity-schema',
        packId: 'mini-world',
        file: 'promotions.json',
        kind: 'promotion',
        recordKey: 'harbour-city-wrestling',
        path: ['promotion', 'harbour-city-wrestling', 'prestige'],
      }),
    ]);
  });

  it('reports a world integrity problem against the record that caused it', () => {
    const world = readFixturePack('mini-world');
    const reigns = [
      {
        key: 'hcw-heavyweight-jack-1',
        titleKey: 'hcw-heavyweight',
        holderPersonKeys: ['jack-marlow', 'nina-vale'],
        wonOn: '2025-09-13',
        lostOn: null,
        endReason: null,
        defences: 0,
      },
    ];
    const result = loadWorldFromPacks(
      [readFixturePack('mini-base'), withFiles(world, { titleReign: reigns })],
      BASE_ROOTS,
      { seed: 'mini-seed' },
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'entity-schema',
        kind: 'titleReign',
        recordKey: 'hcw-heavyweight-jack-1',
      }),
    );
    expect(result.issues.find((issue) => issue.kind === 'titleReign')?.message).toContain(
      'titleReigns.holderCountMismatch',
    );
  });

  it('loads a one-sided neighbour both ways and passes the warning on', () => {
    const borderAddon = testPack({
      id: 'border-addon',
      dependsOn: [{ id: 'mini-world', version: '*' }],
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
    const result = loadWorldFromPacks(
      [...miniWorldPacks(), borderAddon],
      ['mini-world', 'border-addon'],
      { seed: 'mini-seed' },
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.issues));
    }
    expect(result.issues.map((issue) => [issue.severity, issue.code])).toEqual([
      ['warning', 'one-sided-neighbour'],
    ]);
    const { world } = result.value;
    const lowlands = findRow(world.tables.regions, idOf(world, 'region', 'vell-lowlands'));
    expect(lowlands?.neighbourRegionIds).toEqual([
      idOf(world, 'region', 'north-ridge'),
      idOf(world, 'region', 'east-marsh'),
    ]);
  });

  it('returns the content library outside the world, frozen', () => {
    const { library, world } = load(miniWorldPacks());
    expect(Object.keys(library.nameCultures)).toEqual(['cormeric']);
    expect(library.packs).toEqual(world.meta.contentPacks);
    expect(Object.isFrozen(library)).toBe(true);
    expect(Object.isFrozen(library.nameCultures['cormeric']?.surnames)).toBe(true);
    expect(JSON.stringify(world.meta)).not.toContain('Marlow');
  });

  it('needs a start date when no world pack is loaded', () => {
    const result = loadWorldFromPacks([readFixturePack('mini-base')], ['mini-base'], {
      seed: 'mini-seed',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-start-date']);

    const withDate = loadWorldFromPacks([readFixturePack('mini-base')], ['mini-base'], {
      seed: 'mini-seed',
      startDate: START_DATE,
    });
    expect(withDate.ok).toBe(true);
  });

  it('throws for settings a caller should never pass', () => {
    const content = mergedContent(miniWorldPacks(), BASE_ROOTS);
    expect(() =>
      materialiseWorld(content, {
        seed: 'mini-seed',
        startDate: START_DATE,
        settings: { season: { lengthDays: 3 } },
      }),
    ).toThrow(/settings/);
  });
});

describe('loadWorldFromPacks', () => {
  it('loads the worked example from the format doc', () => {
    const files = readExamplePack();
    const manifest = packManifestSchema.parse(files.get('pack.json'));
    const records: RawPack['files'] = {};
    for (const [kind, file] of Object.entries(manifest.files)) {
      if (isRecordKind(kind)) {
        records[kind] = files.get(file);
      }
    }
    const { world } = load([{ manifest, files: records }], ['example-world']);
    const [region] = world.tables.regions.values();
    expect(region).toMatchObject({ wrestlingInterest: 62, preferredStyle: 'traditional' });
    expect(world.tables.employments.size).toBe(1);
    expect(world.meta.startDate).toBe('2026-01-05');
  });

  it('never reads files, paths or browser APIs', () => {
    const sourceDir = fileURLToPath(new URL('../../../src/persistence/packs/', import.meta.url));
    const sources = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' }).filter((file) =>
      file.endsWith('.ts'),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(`${sourceDir}${file}`, 'utf8');
      expect(text, file).not.toMatch(/from '(node:)?(fs|path)(\/[a-z]+)?'/);
      expect(text, file).not.toMatch(/from '[^']*apps\//);
      expect(text, file).not.toMatch(/\b(window|document|localStorage|indexedDB)\./);
    }
  });
});
