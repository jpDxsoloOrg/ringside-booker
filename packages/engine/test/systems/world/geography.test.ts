// Geography roll-ups and picks. Design: docs/design/geography.md#aggregation
import '../../core/rng/testStreams';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGeography,
  findTraceNodes,
  geographyOf,
  InvalidArgumentError,
  InvalidOddsError,
  loadWorldFromPacks,
  packManifestSchema,
  parseGameDate,
  pickRegion,
  RECORD_KINDS,
  regionWeight,
  RngRegistry,
  type Continent,
  type Country,
  type RawPack,
  type RecordKind,
  type Region,
  type RegionId,
} from '@ringside/engine';
import { aContinent, aCountry, aRegion } from '../../support/builders/geography';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const CONTINENT_ONE = testId('continent', 1);
const CONTINENT_TWO = testId('continent', 2);
const BIG_COUNTRY = testId('country', 1);
const SMALL_COUNTRY = testId('country', 2);
const ISLAND = testId('country', 3);
const NORTH = testId('region', 1);
const SOUTH = testId('region', 2);
const SMALL_ALL = testId('region', 3);
const ISLAND_ALL = testId('region', 4);

/**
 * Two continents. The first holds a two-region country ({10M, 30M}) and a one-region country
 * (40M); the second holds an island with one `-all` region.
 */
function testMap(): {
  continents: Continent[];
  countries: Country[];
  regions: Region[];
} {
  const continents = [
    aContinent({ id: CONTINENT_ONE, name: 'Mainland' }),
    aContinent({ id: CONTINENT_TWO, name: 'Ocean' }),
  ];
  const countries = [
    aCountry({ id: BIG_COUNTRY, continentId: CONTINENT_ONE, name: 'Bigland', population: 40e6 }),
    aCountry({ id: SMALL_COUNTRY, continentId: CONTINENT_ONE, name: 'Smallia', population: 40e6 }),
    aCountry({ id: ISLAND, continentId: CONTINENT_TWO, name: 'Isle', population: 2e6 }),
  ];
  const regions = [
    aRegion({ id: NORTH, countryId: BIG_COUNTRY, name: 'North', population: 10e6 }),
    aRegion({ id: SOUTH, countryId: BIG_COUNTRY, name: 'South', population: 30e6 }),
    aRegion({ id: SMALL_ALL, countryId: SMALL_COUNTRY, name: 'Smallia', population: 40e6 }),
    aRegion({ id: ISLAND_ALL, countryId: ISLAND, name: 'Isle', population: 2e6 }),
  ];
  return { continents, countries, regions };
}

function valueOf<Key>(map: ReadonlyMap<Key, { value: number }>, key: Key): number {
  const entry = map.get(key);
  if (entry === undefined) {
    throw new Error(`No aggregate for ${String(key)}`);
  }
  return entry.value;
}

describe('hierarchy lookups', () => {
  const geography = createGeography(testMap());

  it('lists a country’s regions, most populous first', () => {
    expect(geography.regionsOf(BIG_COUNTRY).map((region) => region.id)).toEqual([SOUTH, NORTH]);
    expect(geography.regionsOf(testId('country', 99))).toEqual([]);
  });

  it('finds the country and continent of a region', () => {
    expect(geography.countryOf(NORTH).id).toBe(BIG_COUNTRY);
    expect(geography.continentOf(NORTH).id).toBe(CONTINENT_ONE);
    expect(geography.continentOf(ISLAND_ALL).id).toBe(CONTINENT_TWO);
  });

  it('throws for a region that is not on the map', () => {
    expect(() => geography.countryOf(testId('region', 99))).toThrow(InvalidArgumentError);
  });
});

describe('aggregateByCountry', () => {
  const geography = createGeography(testMap());

  it('is the population-weighted mean of the regions', () => {
    const values = new Map<RegionId, number>([
      [NORTH, 50],
      [SOUTH, 10],
    ]);
    const result = geography.aggregateByCountry(values).get(BIG_COUNTRY);
    expect(result?.value).toBe(20);
    if (result === undefined) {
      return;
    }
    expectTraceReplays(result);
    expect(result.trace.label).toBe('Value in Bigland');
    expect(result.trace.docRef).toBe('geography.md#aggregation');
    // Each region's value and population share are inputs to the trace.
    const inputs = findTraceNodes(result.trace, 'input').map((node) => [node.label, node.value]);
    expect(inputs).toEqual(
      expect.arrayContaining([
        ['Value in South', 10],
        ['Share of population', 0.75],
        ['Value in North', 50],
        ['Share of population', 0.25],
      ]),
    );
    expect(findTraceNodes(result.trace, 'add').map((node) => node.reason)).toEqual([
      '75.0% of the population',
      '25.0% of the population',
    ]);
  });

  it('counts a region missing from the map as 0', () => {
    const values = new Map<RegionId, number>([[NORTH, 80]]);
    const result = geography.aggregateByCountry(values).get(BIG_COUNTRY);
    expect(result?.value).toBe(20);
    if (result !== undefined) {
      expectTraceReplays(result);
      expect(findTraceNodes(result.trace, 'input').map((node) => node.label)).toContain(
        'Value in South (none, counts as 0)',
      );
    }
  });

  it('gives a country with one -all region exactly that region’s value', () => {
    const values = new Map<RegionId, number>([[ISLAND_ALL, 37.3]]);
    expect(valueOf(geography.aggregateByCountry(values), ISLAND)).toBe(37.3);
  });

  it('returns every country, with 0 where nothing is known', () => {
    const aggregates = geography.aggregateByCountry(new Map());
    expect([...aggregates.keys()]).toEqual([BIG_COUNTRY, SMALL_COUNTRY, ISLAND]);
    expect([...aggregates.values()].map((result) => result.value)).toEqual([0, 0, 0]);
  });

  it('uses the value label and unit in the trace', () => {
    const result = geography
      .aggregateByCountry(new Map([[ISLAND_ALL, 12]]), { valueLabel: 'Popularity', unit: 'points' })
      .get(ISLAND);
    expect(result?.trace.label).toBe('Popularity in Isle');
    expect(result?.trace.unit).toBe('points');
  });

  it('shares equally between regions when nobody lives in the country', () => {
    const empty = createGeography({
      continents: [aContinent({ id: CONTINENT_ONE })],
      countries: [aCountry({ id: BIG_COUNTRY, continentId: CONTINENT_ONE, population: 0 })],
      regions: [
        aRegion({ id: NORTH, countryId: BIG_COUNTRY, population: 0 }),
        aRegion({ id: SOUTH, countryId: BIG_COUNTRY, population: 0 }),
      ],
    });
    const result = empty.aggregateByCountry(
      new Map([
        [NORTH, 30],
        [SOUTH, 10],
      ]),
    );
    expect(valueOf(result, BIG_COUNTRY)).toBe(20);
  });

  it('is 0 for a country with no regions', () => {
    const bare = createGeography({
      continents: [aContinent({ id: CONTINENT_ONE })],
      countries: [aCountry({ id: BIG_COUNTRY, continentId: CONTINENT_ONE })],
      regions: [],
    });
    const result = bare.aggregateByCountry(new Map()).get(BIG_COUNTRY);
    expect(result?.value).toBe(0);
    if (result !== undefined) {
      expectSerialisable(result);
    }
  });
});

describe('aggregateByContinent', () => {
  const geography = createGeography(testMap());

  it('weights each country by its share of the continent’s population', () => {
    // Bigland (40M) averages 20, Smallia (40M) has 60: the continent is 40.
    const values = new Map<RegionId, number>([
      [NORTH, 50],
      [SOUTH, 10],
      [SMALL_ALL, 60],
    ]);
    const result = geography.aggregateByContinent(values).get(CONTINENT_ONE);
    expect(result?.value).toBe(40);
    if (result !== undefined) {
      expectTraceReplays(result);
      expect(result.trace.label).toBe('Value in Mainland');
    }
  });

  it('weights unequal countries by population', () => {
    const uneven = createGeography({
      continents: [aContinent({ id: CONTINENT_ONE })],
      countries: [
        aCountry({ id: BIG_COUNTRY, continentId: CONTINENT_ONE, population: 30e6 }),
        aCountry({ id: SMALL_COUNTRY, continentId: CONTINENT_ONE, population: 10e6 }),
      ],
      regions: [
        aRegion({ id: NORTH, countryId: BIG_COUNTRY, population: 30e6 }),
        aRegion({ id: SMALL_ALL, countryId: SMALL_COUNTRY, population: 10e6 }),
      ],
    });
    const values = new Map<RegionId, number>([
      [NORTH, 80],
      [SMALL_ALL, 40],
    ]);
    const result = uneven.aggregateByContinent(values).get(CONTINENT_ONE);
    expect(result?.value).toBe(70);
    if (result !== undefined) {
      expectTraceReplays(result);
    }
  });

  it('equals the population-weighted mean over every region of the continent', () => {
    const values = new Map<RegionId, number>([
      [NORTH, 33],
      [SOUTH, 71],
      [SMALL_ALL, 12],
    ]);
    const expected = (33 * 10 + 71 * 30 + 12 * 40) / 80;
    expect(valueOf(geography.aggregateByContinent(values), CONTINENT_ONE)).toBeCloseTo(
      expected,
      10,
    );
  });
});

describe('regionWeight', () => {
  it('is population × interest / 100', () => {
    expect(regionWeight(aRegion({ population: 2_000_000, wrestlingInterest: 35 }))).toBe(700_000);
    expect(regionWeight(aRegion({ population: 2_000_000, wrestlingInterest: 0 }))).toBe(0);
  });
});

describe('pickRegion', () => {
  it('picks with odds proportional to the weights', () => {
    const light = aRegion({ id: NORTH });
    const heavy = aRegion({ id: SOUTH });
    const weights = new Map<RegionId, number>([
      [NORTH, 1],
      [SOUTH, 3],
    ]);
    const stream = new RngRegistry('geo-pick').stream('test.alpha');
    const draws = 40_000;
    let heavyPicks = 0;
    for (let draw = 0; draw < draws; draw++) {
      const picked = pickRegion(stream, [light, heavy], (region) => weights.get(region.id) ?? 0);
      if (picked.id === SOUTH) {
        heavyPicks++;
      }
    }
    expect(Math.abs(heavyPicks / draws - 0.75)).toBeLessThanOrEqual(0.01);
  });

  it('throws when there is nothing to pick', () => {
    const stream = new RngRegistry('geo-pick').stream('test.alpha');
    expect(() => pickRegion(stream, [], () => 1)).toThrow(InvalidOddsError);
    expect(() => pickRegion(stream, [aRegion()], () => 0)).toThrow(InvalidOddsError);
  });
});

// ---------------------------------------------------------------------------------------------
// The shipped base pack

const BASE_PACK_ROOT = fileURLToPath(new URL('../../../../../content/base/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readBasePack(): RawPack {
  const manifest = packManifestSchema.parse(readJson(`${BASE_PACK_ROOT}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${BASE_PACK_ROOT}${file}`);
    }
  }
  return { manifest, files };
}

describe('the shipped base geography', () => {
  const loaded = loadWorldFromPacks([readBasePack()], ['base'], {
    seed: 'base-geography',
    startDate: parseGameDate('2026-01-05'),
  });

  it('loads with no errors and no warnings', () => {
    expect(loaded.issues).toEqual([]);
    expect(loaded.ok).toBe(true);
  });

  it('has six continents, about 45 countries and about 90 regions', () => {
    if (!loaded.ok) {
      throw new Error('The base pack did not load');
    }
    const geography = geographyOf(loaded.value.world);
    expect(geography.continents.map((continent) => continent.code).sort()).toEqual([
      'AF',
      'AS',
      'EU',
      'LA',
      'NA',
      'OC',
    ]);
    expect(geography.countries.length).toBeGreaterThanOrEqual(40);
    expect(geography.countries.length).toBeLessThanOrEqual(50);
    expect(geography.regions.length).toBeGreaterThanOrEqual(80);
    expect(geography.regions.length).toBeLessThanOrEqual(100);
    for (const continent of geography.continents) {
      expect(geography.countriesOf(continent.id).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives every country regions that add up to its population within 5%', () => {
    if (!loaded.ok) {
      throw new Error('The base pack did not load');
    }
    const geography = geographyOf(loaded.value.world);
    for (const country of geography.countries) {
      const regions = geography.regionsOf(country.id);
      expect(regions.length, country.name).toBeGreaterThan(0);
      const total = regions.reduce((sum, region) => sum + region.population, 0);
      expect(Math.abs(total - country.population), country.name).toBeLessThanOrEqual(
        country.population * 0.05,
      );
    }
  });

  it('rolls a uniform value up to the same value everywhere', () => {
    if (!loaded.ok) {
      throw new Error('The base pack did not load');
    }
    const geography = geographyOf(loaded.value.world);
    const values = new Map(geography.regions.map((region) => [region.id, 50]));
    for (const result of geography.aggregateByCountry(values).values()) {
      expect(result.value).toBeCloseTo(50, 9);
      expectTraceReplays(result, 1e-9);
    }
    for (const result of geography.aggregateByContinent(values).values()) {
      expect(result.value).toBeCloseTo(50, 9);
      expectSerialisable(result);
    }
  });
});
