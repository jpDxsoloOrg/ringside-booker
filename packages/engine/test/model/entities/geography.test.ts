import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UniqueIndexError } from '../../../src/core/errors';
import {
  ContinentSchema,
  CountrySchema,
  RegionSchema,
} from '../../../src/model/entities/geography';
import { checkWorld } from '../../../src/model/integrity';
import {
  emptyGeoMediaWorld,
  GEO_MEDIA_REGISTRY,
  makeContinent,
  makeCountry,
  makeRegion,
  testId,
} from '../../support/geo-media-fixtures';

/** A world with one continent, one country and the given regions. */
function worldWithRegions(...regions: ReturnType<typeof makeRegion>[]) {
  const world = emptyGeoMediaWorld();
  world.tables.continents._put(makeContinent(1));
  world.tables.countries._put(makeCountry(1));
  for (const region of regions) {
    world.tables.regions._put(region);
  }
  return world;
}

describe('continent and country schemas', () => {
  it('accept valid rows', () => {
    expect(ContinentSchema.safeParse(makeContinent(1)).success).toBe(true);
    expect(CountrySchema.safeParse(makeCountry(1)).success).toBe(true);
    expect(CountrySchema.safeParse(makeCountry(1, { preferredStyle: 'hardcore' })).success).toBe(
      true,
    );
  });

  it('rejects a lowercase country code', () => {
    const result = CountrySchema.safeParse(makeCountry(1, { code: 'usa' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['code']);
  });

  it('rejects codes of the wrong length and a fractional population', () => {
    expect(ContinentSchema.safeParse(makeContinent(1, { code: 'E' })).success).toBe(false);
    expect(CountrySchema.safeParse(makeCountry(1, { code: 'ABCD' })).success).toBe(false);
    expect(CountrySchema.safeParse(makeCountry(1, { population: 10.5 })).success).toBe(false);
    expect(CountrySchema.safeParse(makeCountry(1, { economy: 101 })).success).toBe(false);
  });

  it('rejects a duplicate country code through the unique index', () => {
    const world = emptyGeoMediaWorld();
    world.tables.countries._put(makeCountry(1, { code: 'GBR' }));
    expect(() => {
      world.tables.countries._put(makeCountry(2, { code: 'GBR' }));
    }).toThrow(UniqueIndexError);
    expect(world.tables.countries.size).toBe(1);
    expect(world.tables.countries.lookupOne('byCode', 'GBR')?.id).toBe(testId('country', 1));
  });

  it('rejects a duplicate continent code through the unique index', () => {
    const world = emptyGeoMediaWorld();
    world.tables.continents._put(makeContinent(1, { code: 'EU' }));
    expect(() => {
      world.tables.continents._put(makeContinent(2, { code: 'EU' }));
    }).toThrow(UniqueIndexError);
  });

  it('indexes countries by continent', () => {
    const world = emptyGeoMediaWorld();
    world.tables.countries._put(makeCountry(1, { code: 'AAA' }));
    world.tables.countries._put(makeCountry(2, { code: 'BBB' }));
    world.tables.countries._put(
      makeCountry(3, { code: 'CCC', continentId: testId('continent', 2) }),
    );
    expect(
      world.tables.countries.lookup('byContinent', testId('continent', 1)).map((row) => row.id),
    ).toEqual([testId('country', 1), testId('country', 2)]);
  });
});

describe('region schema', () => {
  it('accepts a valid region with neighbours', () => {
    const region = makeRegion(1, { neighbourRegionIds: [testId('region', 2)] });
    expect(RegionSchema.safeParse(region).success).toBe(true);
  });

  it('rejects a region that lists itself as a neighbour', () => {
    const result = RegionSchema.safeParse(
      makeRegion(1, { neighbourRegionIds: [testId('region', 2), testId('region', 1)] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['neighbourRegionIds', 1]);
  });

  it('rejects a neighbour listed twice', () => {
    const result = RegionSchema.safeParse(
      makeRegion(1, { neighbourRegionIds: [testId('region', 2), testId('region', 2)] }),
    );
    expect(result.success).toBe(false);
  });
});

describe('geography integrity', () => {
  it('a consistent hierarchy with mutual neighbours passes', () => {
    const world = worldWithRegions(
      makeRegion(1, { neighbourRegionIds: [testId('region', 2)] }),
      makeRegion(2, { neighbourRegionIds: [testId('region', 1)] }),
    );
    const report = checkWorld(world, GEO_MEDIA_REGISTRY, { validateRows: true });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports a region with a dangling countryId', () => {
    const missingCountry = testId('country', 99);
    const world = worldWithRegions(makeRegion(1, { countryId: missingCountry }));
    const report = checkWorld(world, GEO_MEDIA_REGISTRY);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'regions',
        id: testId('region', 1),
        path: 'countryId',
        missingId: missingCountry,
      }),
    ]);
  });

  it('reports a neighbour that does not list the region back', () => {
    const world = worldWithRegions(
      makeRegion(1, { neighbourRegionIds: [testId('region', 2)] }),
      makeRegion(2),
    );
    const report = checkWorld(world, GEO_MEDIA_REGISTRY);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'region.neighbourNotMutual',
        table: 'regions',
        id: testId('region', 1),
        path: 'neighbourRegionIds[0]',
      }),
    ]);
  });
});

describe('locations are always IDs', () => {
  const entitiesDir = fileURLToPath(new URL('../../../src/model/entities/', import.meta.url));
  /** A field named for a location level: `homeRegion`, `countryId`, `continentIds`, ... */
  const LOCATION_FIELD = /^\s*(\w*(?:continent|country|region)(?:Ids?)?)\??\s*:\s*(.*)$/i;
  /** What a location field's value must be built from: an ID schema or an ID type. */
  const ID_TYPED =
    /zId\('(?:continent|country|region)'\)|zUniqueIdList\('(?:continent|country|region)'\)|\b(?:Continent|Country|Region)Id\b/;

  it('every location field in the entity schemas is ID-typed', () => {
    const offenders: string[] = [];
    let fieldsChecked = 0;
    for (const fileName of readdirSync(entitiesDir).filter((name) => name.endsWith('.ts'))) {
      const lines = readFileSync(`${entitiesDir}${fileName}`, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
          return;
        }
        const match = LOCATION_FIELD.exec(line);
        if (match === null) {
          return;
        }
        fieldsChecked += 1;
        // A value that wraps onto the next line (a long `z.array(` call) is checked with it.
        const value = `${match[2] ?? ''} ${lines[index + 1] ?? ''}`;
        if (!ID_TYPED.test(value)) {
          offenders.push(`${fileName}:${String(index + 1)}: ${trimmed}`);
        }
      });
    }
    expect(offenders).toEqual([]);
    expect(fieldsChecked).toBeGreaterThan(5);
  });
});
