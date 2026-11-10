// The D-03 popularity roll-up. Design: docs/design/geography.md#popularity-roll-up
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countTraceNodes,
  createPopularityRoller,
  findTraceNodes,
  geographyOf,
  loadWorldFromPacks,
  packManifestSchema,
  popularityRollup,
  popularityRollupView,
  RECORD_KINDS,
  TRACE_MAX_NODES,
  type ContinentId,
  type CountryId,
  type Geography,
  type RawPack,
  type RecordKind,
  type RegionalPopularity,
  type RegionId,
  type Traced,
} from '@ringside/engine';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';

const EPSILON = 1e-9;

/** Mini geography populations: North is 1.8M + 1.2M, South is 1.1M + 0.9M. */
const NORTH_ONE_POPULATION = 1_800_000;
const NORTH_TWO_POPULATION = 1_200_000;
const NORTH_POPULATION = NORTH_ONE_POPULATION + NORTH_TWO_POPULATION;
const SOUTH_POPULATION = 2_000_000;
const WORLD_POPULATION = NORTH_POPULATION + SOUTH_POPULATION;

function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) {
    throw new Error(`Missing ${what}`);
  }
  return value;
}

function miniWorld() {
  const { world, ids } = worldBuilder().withGeography('mini').build();
  const [northOne, northTwo, southOne, southTwo] = ids.regions;
  const [north, south] = ids.countries;
  return {
    geography: geographyOf(world),
    continent: required(ids.continents[0], 'continent'),
    north: required(north, 'north'),
    south: required(south, 'south'),
    northOne: required(northOne, 'north 1'),
    northTwo: required(northTwo, 'north 2'),
    southOne: required(southOne, 'south 1'),
    southTwo: required(southTwo, 'south 2'),
  };
}

function valueOf<Key>(map: ReadonlyMap<Key, Traced<number>>, key: Key): number {
  return required(map.get(key), `aggregate for ${String(key)}`).value;
}

describe('popularityRollup on the mini geography', () => {
  it('is 0 at every level for an empty map, with no top place', () => {
    const { geography, continent, north, south } = miniWorld();
    const rollup = popularityRollup({}, geography);
    expect(rollup.world.value).toBe(0);
    expect(valueOf(rollup.continents, continent)).toBe(0);
    expect(valueOf(rollup.countries, north)).toBe(0);
    expect(valueOf(rollup.countries, south)).toBe(0);
    expect(rollup.regions.size).toBe(0);
    expectTraceReplays(rollup.world);

    const values = createPopularityRoller(geography).rollValues({});
    expect(values).toEqual({
      world: 0,
      continents: { [continent]: 0 },
      countries: { [north]: 0, [south]: 0 },
      top: null,
      topContinent: null,
    });
  });

  it('rolls one region up through its country, continent and the world', () => {
    const { geography, continent, north, south, northTwo } = miniWorld();
    const rollup = popularityRollup({ [northTwo]: 60 }, geography);
    // North 2 is 1.2M of North's 3M, and North is 3M of the continent's 5M.
    const northValue = (60 * NORTH_TWO_POPULATION) / NORTH_POPULATION;
    expect(valueOf(rollup.countries, north)).toBeCloseTo(northValue, 9);
    expect(valueOf(rollup.countries, south)).toBe(0);
    expect(valueOf(rollup.continents, continent)).toBeCloseTo(
      (northValue * NORTH_POPULATION) / WORLD_POPULATION,
      9,
    );
    expect(rollup.world.value).toBeCloseTo((60 * NORTH_TWO_POPULATION) / WORLD_POPULATION, 9);
    expect([...rollup.regions]).toEqual([[northTwo, 60]]);

    const values = createPopularityRoller(geography).rollValues({ [northTwo]: 60 });
    expect(values.top).toEqual({ countryId: north, value: valueOf(rollup.countries, north) });
    expect(values.topContinent?.continentId).toBe(continent);
  });

  it('gives a country the hand-computed population-weighted mean of its regions', () => {
    const { geography, north, northOne, northTwo } = miniWorld();
    const rollup = popularityRollup({ [northOne]: 50, [northTwo]: 10 }, geography);
    // 50 × 0.6 + 10 × 0.4
    expect(valueOf(rollup.countries, north)).toBeCloseTo(34, 9);
    const country = required(rollup.countries.get(north), 'north');
    expect(country.trace.label).toBe('Popularity in Test Country North');
    expect(country.trace.unit).toBe('points');
    // The Why? lists each region with its value and population share, largest population first.
    expect(findTraceNodes(country.trace, 'add').map((node) => [node.label, node.reason])).toEqual([
      ['Test Region North 1', '60.0% of the population'],
      ['Test Region North 2', '40.0% of the population'],
    ]);
    expect(
      findTraceNodes(country.trace, 'input')
        .filter((node) => node.ref !== undefined)
        .map((node) => [node.label, node.value, node.ref?.id]),
    ).toEqual([
      ['Popularity in Test Region North 1', 50, northOne],
      ['Popularity in Test Region North 2', 10, northTwo],
    ]);
  });

  it('makes the world the population-weighted mean of the continents', () => {
    const { geography, continent, northOne, southTwo } = miniWorld();
    const rollup = popularityRollup({ [northOne]: 80, [southTwo]: 20 }, geography);
    // One continent holds everybody, so the world is that continent.
    expect(rollup.world.value).toBeCloseTo(valueOf(rollup.continents, continent), 9);
    expect(rollup.world.value).toBeCloseTo(
      (80 * NORTH_ONE_POPULATION + 20 * 900_000) / WORLD_POPULATION,
      9,
    );
    expect(rollup.world.trace.label).toBe('Popularity worldwide');
    expect(findTraceNodes(rollup.world.trace, 'add').map((node) => node.label)).toContain(
      'Test Continent',
    );
  });

  it('uses the given value label in every trace', () => {
    const { geography, continent, north, northOne } = miniWorld();
    const rollup = popularityRollup({ [northOne]: 40 }, geography, { valueLabel: 'Fan base' });
    expect(rollup.world.trace.label).toBe('Fan base worldwide');
    expect(rollup.continents.get(continent)?.trace.label).toBe('Fan base in Test Continent');
    expect(rollup.countries.get(north)?.trace.label).toBe('Fan base in Test Country North');
  });

  it('replays the world, continent and country traces', () => {
    const { geography, continent, south, northOne, southOne, southTwo } = miniWorld();
    const rollup = popularityRollup({ [northOne]: 72, [southOne]: 13, [southTwo]: 99 }, geography);
    expectTraceReplays(rollup.world);
    expectTraceReplays(required(rollup.continents.get(continent), 'continent'));
    expectTraceReplays(required(rollup.countries.get(south), 'south'));
  });

  it('breaks a tie for the top country by country ID', () => {
    const { geography, north, northOne, northTwo, southOne, southTwo } = miniWorld();
    const everywhere = { [northOne]: 30, [northTwo]: 30, [southOne]: 30, [southTwo]: 30 };
    const values = createPopularityRoller(geography).rollValues(everywhere);
    expect(values.top?.countryId).toBe(north);
    expect(values.top?.value).toBeCloseTo(30, 9);
  });
});

describe('popularityRollupView', () => {
  it('is plain JSON, sorted by value then name, with regions by population', () => {
    const { geography, continent, north, south, northTwo, southOne, southTwo } = miniWorld();
    const rollup = popularityRollup({ [southOne]: 40, [southTwo]: 90, [northTwo]: 5 }, geography);
    const view = popularityRollupView(rollup, geography);
    expectSerialisable(view);

    expect(view.world.value).toBe(rollup.world.value);
    expect(view.world.trace).toBe(rollup.world.trace);
    expect(view.continents.map((entry) => entry.id)).toEqual([continent]);
    const [onlyContinent] = view.continents;
    expect(onlyContinent?.name).toBe('Test Continent');
    expect(onlyContinent?.trace.label).toBe('Popularity in Test Continent');
    // South is more popular, so it comes first although North has more people.
    expect(onlyContinent?.countries.map((entry) => entry.id)).toEqual([south, north]);
    const southView = required(onlyContinent?.countries[0], 'south view');
    expect(southView.value).toBeCloseTo((40 * 1_100_000 + 90 * 900_000) / SOUTH_POPULATION, 9);
    expect(southView.trace.label).toBe('Popularity in Test Country South');
    expect(southView.regions).toEqual([
      { id: southOne, name: 'Test Region South 1', population: 1_100_000, value: 40 },
      { id: southTwo, name: 'Test Region South 2', population: 900_000, value: 90 },
    ]);
    // A region with no stored value is listed at 0.
    expect(onlyContinent?.countries[1]?.regions.map((region) => region.value)).toEqual([0, 5]);
  });

  it('sorts equal values by name', () => {
    const { geography, north, south } = miniWorld();
    const view = popularityRollupView(popularityRollup({}, geography), geography);
    expect(view.continents[0]?.countries.map((entry) => entry.id)).toEqual([north, south]);
  });
});

// ---------------------------------------------------------------------------------------------
// The shipped default world: the fast path against the traced one, for everybody.

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readContentPack(folder: string): RawPack {
  const packRoot = `${CONTENT_ROOT}${folder}/`;
  const manifest = packManifestSchema.parse(readJson(`${packRoot}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${packRoot}${file}`);
    }
  }
  return { manifest, files };
}

function defaultWorld() {
  const loaded = loadWorldFromPacks(
    [readContentPack('base'), readContentPack('worlds/default')],
    ['default-world'],
    { seed: 'popularity-rollup' },
  );
  if (!loaded.ok) {
    throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value.world;
}

function expectFastPathMatches(regionalPop: RegionalPopularity, geography: Geography): void {
  const rollup = popularityRollup(regionalPop, geography);
  const values = createPopularityRoller(geography).rollValues(regionalPop);
  expect(Math.abs(values.world - rollup.world.value)).toBeLessThanOrEqual(EPSILON);
  for (const [continentId, aggregate] of rollup.continents) {
    expect(Math.abs((values.continents[continentId] ?? NaN) - aggregate.value)).toBeLessThanOrEqual(
      EPSILON,
    );
  }
  for (const [countryId, aggregate] of rollup.countries) {
    expect(Math.abs((values.countries[countryId] ?? NaN) - aggregate.value)).toBeLessThanOrEqual(
      EPSILON,
    );
  }
  expect(Object.keys(values.continents)).toHaveLength(rollup.continents.size);
  expect(Object.keys(values.countries)).toHaveLength(rollup.countries.size);
}

describe('the roll-up on the default world', () => {
  const world = defaultWorld();
  const geography = geographyOf(world);
  const people = world.tables.people.values();
  const promotions = world.tables.promotions.values();
  const roller = createPopularityRoller(geography);

  it('gives the fast path the traced values for every person and promotion', () => {
    expect(people.length).toBeGreaterThan(200);
    expect(promotions.length).toBeGreaterThan(0);
    for (const person of people) {
      expectFastPathMatches(person.regionalPop, geography);
    }
    for (const promotion of promotions) {
      expectFastPathMatches(promotion.regionalPop, geography);
    }
  });

  it('rolls a promotion’s map the same way as a person’s', () => {
    const promotion = required(
      promotions.find((row) => Object.keys(row.regionalPop).length > 0),
      'a promotion with popularity',
    );
    const rollup = popularityRollup(promotion.regionalPop, geography);
    expect(rollup.world.value).toBeGreaterThan(0);
    expectTraceReplays(rollup.world);
    // The world is the mean over every region, weighted by population.
    const totalPopulation = geography.regions.reduce((sum, region) => sum + region.population, 0);
    const expected = geography.regions.reduce(
      (sum, region) =>
        sum + ((promotion.regionalPop[region.id] ?? 0) * region.population) / totalPopulation,
      0,
    );
    expect(rollup.world.value).toBeCloseTo(expected, 9);
    const home = geography.countryOf(promotion.homeRegionId);
    expect(roller.rollValues(promotion.regionalPop).countries[home.id]).toBeGreaterThan(0);
  });

  it('makes the world the weighted mean of the continents', () => {
    const star = people.reduce((best, person) =>
      Object.keys(person.regionalPop).length > Object.keys(best.regionalPop).length ? person : best,
    );
    const rollup = popularityRollup(star.regionalPop, geography);
    const continentPopulation = (continentId: ContinentId): number =>
      geography
        .countriesOf(continentId)
        .flatMap((country) => geography.regionsOf(country.id))
        .reduce((sum, region) => sum + region.population, 0);
    const totalPopulation = geography.regions.reduce((sum, region) => sum + region.population, 0);
    let expected = 0;
    for (const [continentId, aggregate] of rollup.continents) {
      expected += (aggregate.value * continentPopulation(continentId)) / totalPopulation;
    }
    expect(rollup.world.value).toBeCloseTo(expected, 9);
  });

  it('keeps every trace within the size limit and replayable, and the view serialisable', () => {
    const star = people.reduce((best, person) =>
      Object.keys(person.regionalPop).length > Object.keys(best.regionalPop).length ? person : best,
    );
    const rollup = popularityRollup(star.regionalPop, geography);
    expectTraceReplays(rollup.world);
    expect(countTraceNodes(rollup.world.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES);
    // The world's Why? names every continent, even on a map this size.
    const worldLines = findTraceNodes(rollup.world.trace, 'add').map((node) => node.label);
    for (const continent of geography.continents) {
      expect(worldLines).toContain(continent.name);
    }
    for (const aggregate of rollup.continents.values()) {
      expectTraceReplays(aggregate);
      expect(countTraceNodes(aggregate.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES);
    }
    for (const aggregate of rollup.countries.values()) {
      expectTraceReplays(aggregate);
    }
    const view = popularityRollupView(rollup, geography);
    expectSerialisable(view);
    expect(view.continents).toHaveLength(geography.continents.length);
    const countryIds: CountryId[] = view.continents.flatMap((continent) =>
      continent.countries.map((country) => country.id),
    );
    expect(countryIds).toHaveLength(geography.countries.length);
    const regionIds: RegionId[] = view.continents.flatMap((continent) =>
      continent.countries.flatMap((country) => country.regions.map((region) => region.id)),
    );
    expect(regionIds).toHaveLength(geography.regions.length);
  });
});
