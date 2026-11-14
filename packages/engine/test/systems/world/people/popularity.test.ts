// Starting regional popularity: home first, fading through country, borders, continent and world.
// Design: docs/design/world-generation.md#popularity
import { describe, expect, it } from 'vitest';
import { SLOW_TESTS } from '../../../support/slow';
import {
  createEngineTunables,
  findTraceNodes,
  PersonGenerator,
  regionRelation,
  RngRegistry,
  seedPopularity,
  type CareerStage,
  type Person,
  type RegionalPop,
  type RegionId,
  type RngStream,
  type Traced,
} from '@ringside/engine';
import { RegionalPopSchema } from '../../../../src/model/entities/person';
import { testId } from '../../../support/ids';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import {
  BASE_LIBRARY,
  GEOGRAPHY,
  loadBaseWorld,
  personAged,
  regionNamed,
  WORLD_DATE,
} from './base-world';

type TunableOverrides = Parameters<typeof createEngineTunables>[0];

const TEXAS = regionNamed('Texas');

function popularityStream(seed: string): RngStream {
  return new RngRegistry(seed).stream('worldgen.people.popularity');
}

function seed(
  person: Person,
  stage: CareerStage,
  talent: number,
  overrides: TunableOverrides = {},
  stream: RngStream = popularityStream('popularity'),
): Traced<RegionalPop> {
  return seedPopularity(person, stage, talent, WORLD_DATE, stream, GEOGRAPHY, {
    tunables: createEngineTunables(overrides),
  });
}

function valueIn(popularity: RegionalPop, regionId: RegionId): number | undefined {
  return popularity[regionId];
}

/** A popularity record as the map the geography roll-ups take. */
function asMap(popularity: RegionalPop): Map<RegionId, number> {
  const values = new Map<RegionId, number>();
  for (const region of GEOGRAPHY.regions) {
    const value = popularity[region.id];
    if (value !== undefined) {
      values.set(region.id, value);
    }
  }
  return values;
}

const SAME_COUNTRY = GEOGRAPHY.regions.filter(
  (region) => region.countryId === TEXAS.countryId && region.id !== TEXAS.id,
);
const BORDERING = GEOGRAPHY.regions.filter(
  (region) => regionRelation(GEOGRAPHY, TEXAS, region) === 'neighbour',
);
const OTHER_CONTINENT = GEOGRAPHY.regions.filter(
  (region) => regionRelation(GEOGRAPHY, TEXAS, region) === 'world',
);

describe('regionRelation', () => {
  it('sorts the map into home, country, borders, continent and the rest', () => {
    expect(regionRelation(GEOGRAPHY, TEXAS, TEXAS)).toBe('home');
    expect(SAME_COUNTRY.length).toBeGreaterThan(3);
    expect(BORDERING.map((region) => region.name)).toEqual(
      expect.arrayContaining(['Northwest Mexico']),
    );
    expect(OTHER_CONTINENT.length).toBeGreaterThan(10);
  });
});

describe('seedPopularity', () => {
  // Slow suite only (owner, 2026-11-14: no long-running tests outside the end-of-sprint run).
  it.runIf(SLOW_TESTS)('keeps the maximum at home for every stage and talent', () => {
    const stream = popularityStream('home-max');
    for (const stage of ['rookie', 'prospect', 'established', 'veteran', 'legend'] as const) {
      for (let index = 0; index < 200; index++) {
        const talent = ((index % 13) - 6) / 2;
        const result = seed(personAged(30), stage, talent, {}, stream);
        expect(RegionalPopSchema.safeParse(result.value).success).toBe(true);
        const home = valueIn(result.value, TEXAS.id);
        for (const value of Object.values(result.value)) {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThanOrEqual(home ?? 0);
        }
      }
    }
  });

  it('gives the rest of the country about 0.55 of home and bordering regions about 0.35', () => {
    const result = seed(personAged(45), 'legend', 2, { 'worldgen.popularity.noiseSd': 0 });
    const home = valueIn(result.value, TEXAS.id) ?? 0;
    expect(home).toBe(63);
    for (const region of SAME_COUNTRY) {
      const ratio = (valueIn(result.value, region.id) ?? 0) / home;
      expect(ratio).toBeGreaterThanOrEqual(0.55 * 0.9 - 0.002);
      expect(ratio).toBeLessThanOrEqual(0.55 * 1.1 + 0.002);
    }
    for (const region of BORDERING) {
      const ratio = (valueIn(result.value, region.id) ?? 0) / home;
      expect(ratio).toBeGreaterThanOrEqual(0.35 * 0.9 - 0.002);
      expect(ratio).toBeLessThanOrEqual(0.35 * 1.1 + 0.002);
    }
  });

  it('leaves a rookie unknown on other continents', () => {
    const stream = popularityStream('rookie');
    for (let index = 0; index < 200; index++) {
      const result = seed(personAged(20), 'rookie', 0, {}, stream);
      for (const region of OTHER_CONTINENT) {
        expect(region.id in result.value).toBe(false);
      }
    }
  });

  it('stores only home when every spread is 0', () => {
    const result = seed(personAged(45), 'legend', 1, {
      'worldgen.popularity.countrySpread': 0,
      'worldgen.popularity.neighbourSpread': 0,
      'worldgen.popularity.continentSpread': 0,
      'worldgen.popularity.worldSpread': 0,
    });
    expect(Object.keys(result.value)).toEqual([TEXAS.id]);
  });

  it('gives exact shares with no variation and a floor of 0', () => {
    const result = seed(personAged(45), 'veteran', 0, {
      'worldgen.popularity.noiseSd': 0,
      'worldgen.popularity.regionNoise': 0,
      'worldgen.popularity.storeFloor': 0,
    });
    expect(valueIn(result.value, TEXAS.id)).toBe(30);
    for (const region of SAME_COUNTRY) {
      expect(valueIn(result.value, region.id)).toBe(16.5);
    }
    for (const region of BORDERING) {
      expect(valueIn(result.value, region.id)).toBe(10.5);
    }
    for (const region of OTHER_CONTINENT) {
      expect(valueIn(result.value, region.id)).toBe(1.2);
    }
    expect(Object.keys(result.value)).toHaveLength(GEOGRAPHY.regions.length);
  });

  it('starts people who do not wrestle at 0.4 of the same reputation', () => {
    const flat = { 'worldgen.popularity.noiseSd': 0 };
    const wrestler = seed(personAged(35), 'established', 1, flat);
    const referee = seed(
      personAged(35, { roles: ['referee'], style: 'nonWrestler' }),
      'established',
      1,
      flat,
    );
    expect(valueIn(referee.value, TEXAS.id)).toBe(
      Math.round((valueIn(wrestler.value, TEXAS.id) ?? 0) * 0.4 * 10) / 10,
    );
    const none = seed(personAged(35, { roles: ['referee'], style: 'nonWrestler' }), 'legend', 2, {
      'worldgen.popularity.nonPerformerFactor': 0,
    });
    expect(none.value).toEqual({});
  });

  it('rolls up to sensible country figures with the geography helpers', () => {
    const result = seed(personAged(36), 'established', 0.5);
    const byCountry = GEOGRAPHY.aggregateByCountry(asMap(result.value), {
      valueLabel: 'Popularity',
    });
    const homeCountry = byCountry.get(TEXAS.countryId)?.value ?? 0;
    const home = valueIn(result.value, TEXAS.id) ?? 0;
    expect(homeCountry).toBeGreaterThan(0.5 * home);
    expect(homeCountry).toBeLessThan(home);
    for (const [countryId, value] of byCountry) {
      if (countryId !== TEXAS.countryId) {
        expect(value.value).toBeLessThan(homeCountry);
      }
    }
    const continents = GEOGRAPHY.aggregateByContinent(asMap(result.value));
    const homeContinent = GEOGRAPHY.continentOf(TEXAS.id).id;
    for (const [continentId, value] of continents) {
      if (continentId !== homeContinent) {
        expect(value.value).toBeLessThan(continents.get(homeContinent)?.value ?? 0);
      }
    }
  });

  it('draws the same amount for everyone, and is deterministic', () => {
    const rookie = popularityStream('count');
    seed(personAged(20), 'rookie', -1, {}, rookie);
    const legend = popularityStream('count');
    seed(personAged(50), 'legend', 3, {}, legend);
    expect(rookie.nextFloat()).toBe(legend.nextFloat());
    expect(seed(personAged(30), 'veteran', 0.3)).toEqual(seed(personAged(30), 'veteran', 0.3));
  });

  it('explains the home reputation and each stored region', () => {
    const result = seed(personAged(30), 'established', 1);
    const reputation = findTraceNodes(result.trace, 'formula').find(
      (node) => node.label === 'Popularity at home',
    );
    expect(reputation).toBeDefined();
    if (reputation !== undefined) {
      expectTraceReplays({ value: Number(reputation.value), trace: reputation });
    }
    const regionNodes = findTraceNodes(result.trace, 'input').filter(
      (node) => node.ref?.kind === 'region',
    );
    expect(regionNodes).toHaveLength(Object.keys(result.value).length);
    expectSerialisable(result);
  });
});

describe('a generated roster', () => {
  it.runIf(SLOW_TESTS)('is mostly known in one or two countries', () => {
    const registry = new RngRegistry('roster-spread');
    const generator = PersonGenerator.forWorld(loadBaseWorld().world, BASE_LIBRARY);
    const count = 500;
    let narrow = 0;
    for (let index = 0; index < count; index++) {
      const { person } = generator.generate(
        { role: 'wrestler' },
        {
          personId: testId('person', index + 1),
          worldDate: WORLD_DATE,
          rng: (name) => registry.stream(name),
        },
      ).value;
      const byCountry = GEOGRAPHY.aggregateByCountry(asMap(person.regionalPop));
      // "Known" in a country: a population-weighted popularity of at least 5 there.
      const known = [...byCountry.values()].filter((value) => value.value >= 5).length;
      narrow += known <= 2 ? 1 : 0;
    }
    expect(narrow / count).toBeGreaterThan(0.65);
  });
});
