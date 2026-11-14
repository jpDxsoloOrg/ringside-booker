/**
 * The popularity roll-up: one person's or promotion's per-region popularity turned into the full
 * picture a screen shows: the world, every continent, every country and the regions underneath.
 *
 * Popularity is stored per region only (design decision D-03). Everything above a region is a
 * population-weighted mean worked out when it is needed, and this file is the one place that does
 * it for popularity, for people and promotions alike:
 *
 * - {@link popularityRollup} gives every level with its "Why?" trace, for a profile or a detail
 *   panel that shows one subject.
 * - {@link createPopularityRoller} gives the same numbers with no traces, for lists that roll up
 *   hundreds of subjects at once.
 * - {@link popularityRollupView} turns a roll-up into plain JSON for a query result.
 *
 * Design: docs/design/geography.md#popularity-roll-up.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { fastPathsEnabled } from '../../../core/fastPaths';
import type { ContinentId, CountryId, RegionId } from '../../../core/ids';
import type { Traced, TraceNode } from '../../../core/trace';
import type { Geography } from '../geography';

/**
 * Popularity per region, as people and promotions store it: sparse, so a region that is missing
 * reads as 0. Both `person.regionalPop` and `promotion.regionalPop` have this shape.
 */
export type RegionalPopularity = Readonly<Partial<Record<RegionId, number>>>;

/** Options for {@link popularityRollup}. */
export interface PopularityRollupOptions {
  /** What the values are called in trace labels. "Popularity" by default. */
  readonly valueLabel?: string;
}

/** Every level of one subject's popularity, each derived level with its trace. */
export interface PopularityRollup {
  /** The population-weighted mean of the continents. */
  readonly world: Traced<number>;
  /** Every continent on the map, 0 where the subject is unknown. */
  readonly continents: Map<ContinentId, Traced<number>>;
  /** Every country on the map, 0 where the subject is unknown. */
  readonly countries: Map<CountryId, Traced<number>>;
  /** The stored values: only the regions the subject has popularity in. */
  readonly regions: ReadonlyMap<RegionId, number>;
}

/** The highest country of a subject, for a list column. */
export interface TopCountryPopularity {
  readonly countryId: CountryId;
  readonly value: number;
}

/** The highest continent of a subject. */
export interface TopContinentPopularity {
  readonly continentId: ContinentId;
  readonly value: number;
}

/** The derived levels as plain numbers, with no traces: what a list row needs. */
export interface PopularityValues {
  readonly world: number;
  /** Every continent on the map, 0 where the subject is unknown. */
  readonly continents: Record<ContinentId, number>;
  /** Every country on the map, 0 where the subject is unknown. */
  readonly countries: Record<CountryId, number>;
  /** The country with the highest value (ties go to the lower ID), or null when every value is 0. */
  readonly top: TopCountryPopularity | null;
  /** The continent with the highest value (ties go to the lower ID), or null when all are 0. */
  readonly topContinent: TopContinentPopularity | null;
}

/** Rolls popularity maps up over one map, with the population shares worked out once. */
export interface PopularityRoller {
  /** The world, continent and country values of one popularity map, untraced. */
  rollValues(regionalPop: RegionalPopularity): PopularityValues;
}

/** A region line of the view: the stored value, with nothing to explain. */
export interface PopularityRegionView {
  readonly id: RegionId;
  readonly name: string;
  readonly population: number;
  readonly value: number;
}

/** A country line of the view, with its trace and its regions, most populous first. */
export interface PopularityCountryView {
  readonly id: CountryId;
  readonly name: string;
  readonly value: number;
  readonly trace: TraceNode;
  readonly regions: PopularityRegionView[];
}

/** A continent line of the view, with its trace and its countries, highest value first. */
export interface PopularityContinentView {
  readonly id: ContinentId;
  readonly name: string;
  readonly value: number;
  readonly trace: TraceNode;
  readonly countries: PopularityCountryView[];
}

/** A roll-up as plain JSON, ready to cross the worker boundary inside a query result. */
export interface PopularityRollupView {
  readonly world: { readonly value: number; readonly trace: TraceNode };
  readonly continents: PopularityContinentView[];
}

const DEFAULT_VALUE_LABEL = 'Popularity';

/**
 * The stored record as the map the geography helpers read, in region ID order. A key that is not a
 * region on this map is left out: it has no population to weigh by.
 */
function regionValues(
  regionalPop: RegionalPopularity,
  geography: Geography,
): Map<RegionId, number> {
  const values = new Map<RegionId, number>();
  for (const region of geography.regions) {
    const value = regionalPop[region.id];
    if (value !== undefined) {
      values.set(region.id, value);
    }
  }
  return values;
}

/**
 * Every level of a person's or promotion's popularity, with a trace on each derived level. A
 * country's trace lists its regions with their population shares, a continent's lists its
 * countries (each holding its own regions), and the world's lists the continents. Regions missing
 * from `regionalPop` count as 0.
 */
export function popularityRollup(
  regionalPop: RegionalPopularity,
  geography: Geography,
  options: PopularityRollupOptions = {},
): PopularityRollup {
  const regions = regionValues(regionalPop, geography);
  const aggregateOptions = {
    valueLabel: options.valueLabel ?? DEFAULT_VALUE_LABEL,
    unit: 'points',
  } as const;
  return {
    world: geography.aggregateWorld(regions, aggregateOptions),
    continents: geography.aggregateByContinent(regions, aggregateOptions),
    countries: geography.aggregateByCountry(regions, aggregateOptions),
    regions,
  };
}

/** The world, one country and one continent of a roll-up: what a headline figure reads. */
export interface PopularityRollupPart {
  readonly world: Traced<number>;
  readonly country: Traced<number>;
  readonly continent: Traced<number>;
  readonly regions: ReadonlyMap<RegionId, number>;
}

/**
 * The world, `countryId`'s and `continentId`'s entries of {@link popularityRollup}, value and trace
 * for value and trace, without working out every other country and continent (POL4-09: a
 * promotion's headline Why? is re-recorded every time its popularity moves).
 */
export function popularityRollupPart(
  regionalPop: RegionalPopularity,
  geography: Geography,
  part: { readonly countryId: CountryId; readonly continentId: ContinentId },
  options: PopularityRollupOptions = {},
): PopularityRollupPart {
  if (!fastPathsEnabled()) {
    const full = popularityRollup(regionalPop, geography, options);
    const country = full.countries.get(part.countryId);
    const continent = full.continents.get(part.continentId);
    if (country === undefined || continent === undefined) {
      // The roll-up lists every country and continent on the map, so this cannot happen.
      throw new InvalidArgumentError('popularityRollupPart', 'part', part, 'a place on the map');
    }
    return { world: full.world, country, continent, regions: full.regions };
  }
  const regions = regionValues(regionalPop, geography);
  const aggregateOptions = {
    valueLabel: options.valueLabel ?? DEFAULT_VALUE_LABEL,
    unit: 'points',
  } as const;
  return {
    world: geography.aggregateWorld(regions, aggregateOptions),
    country: geography.aggregateCountry(part.countryId, regions, aggregateOptions),
    continent: geography.aggregateContinent(part.continentId, regions, aggregateOptions),
    regions,
  };
}

/** Which one level {@link popularityRollupLevel} rolls up. */
export type PopularityRollupLevelSpec =
  | { readonly level: 'world' }
  | { readonly level: 'country'; readonly countryId: CountryId }
  | { readonly level: 'continent'; readonly continentId: ContinentId };

/**
 * One level of {@link popularityRollup}, value and trace for value and trace, without working out
 * any other level (POL4-10: a headline Why? nests only the level its scope picks).
 */
export function popularityRollupLevel(
  regionalPop: RegionalPopularity,
  geography: Geography,
  spec: PopularityRollupLevelSpec,
  options: PopularityRollupOptions = {},
): Traced<number> {
  const regions = regionValues(regionalPop, geography);
  const aggregateOptions = {
    valueLabel: options.valueLabel ?? DEFAULT_VALUE_LABEL,
    unit: 'points',
  } as const;
  switch (spec.level) {
    case 'world':
      return geography.aggregateWorld(regions, aggregateOptions);
    case 'country':
      return geography.aggregateCountry(spec.countryId, regions, aggregateOptions);
    case 'continent':
      return geography.aggregateContinent(spec.continentId, regions, aggregateOptions);
  }
}

/** One member of a group and its share of the group's population. */
interface Share<Id> {
  readonly id: Id;
  readonly share: number;
}

/**
 * Each member's share of the group's population. When nobody lives in the group, the members share
 * equally, the same rule the traced means use.
 */
function populationShares<Id>(
  members: readonly { readonly id: Id; readonly population: number }[],
): Share<Id>[] {
  const total = members.reduce((sum, member) => sum + member.population, 0);
  return members.map((member) => ({
    id: member.id,
    share: total === 0 ? 1 / members.length : member.population / total,
  }));
}

/** The entry with the highest value, the lower ID winning a tie; null when no value is above 0. */
function highest<Id extends string>(values: Readonly<Record<Id, number>>, ids: readonly Id[]) {
  let best: { id: Id; value: number } | null = null;
  // `ids` is in ID order, so keeping the first of equal values is the tie-break.
  for (const id of ids) {
    const value = values[id];
    if (value > 0 && (best === null || value > best.value)) {
      best = { id, value };
    }
  }
  return best;
}

/**
 * The fast path for lists. The population shares (each region's share of its country, each
 * country's of its continent, each continent's of the world) are worked out once here, so rolling
 * a popularity map afterwards is a few dozen multiplications and no trace is built. The numbers
 * are the same as {@link popularityRollup}'s; use that one when the screen shows a "Why?".
 */
export function createPopularityRoller(geography: Geography): PopularityRoller {
  if (!fastPathsEnabled()) {
    return buildPopularityRoller(geography);
  }
  // Fast path (POL4-10): one roller per map. With geographyOf handing back the same map while it
  // is unchanged, the population shares are worked out once instead of on every call.
  let roller = rollers.get(geography);
  if (roller === undefined) {
    roller = buildPopularityRoller(geography);
    rollers.set(geography, roller);
  }
  return roller;
}

/** The rollers made so far, by the map they roll over. */
const rollers = new WeakMap<Geography, PopularityRoller>();

function buildPopularityRoller(geography: Geography): PopularityRoller {
  const countryPopulation = new Map<CountryId, number>();
  const regionShares = new Map<CountryId, Share<RegionId>[]>();
  for (const country of geography.countries) {
    const regions = geography.regionsOf(country.id);
    countryPopulation.set(
      country.id,
      regions.reduce((sum, region) => sum + region.population, 0),
    );
    regionShares.set(country.id, populationShares(regions));
  }

  const continentMembers = geography.continents.map((continent) => {
    const members = geography.countriesOf(continent.id).map((country) => ({
      id: country.id,
      population: countryPopulation.get(country.id) ?? 0,
    }));
    return {
      id: continent.id,
      population: members.reduce((sum, member) => sum + member.population, 0),
      countryShares: populationShares(members),
    };
  });
  // Largest first, then by ID: the order the traced world mean adds the continents in, so the
  // floating-point sums match it step for step.
  const continentShares = populationShares(
    [...continentMembers].sort(
      (left, right) =>
        right.population - left.population ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    ),
  );
  const countryIds = geography.countries.map((country) => country.id);
  const continentIds = geography.continents.map((continent) => continent.id);

  return {
    rollValues(regionalPop) {
      // The casts name the two records' key types; every key is filled in below.
      const countries = {} as Record<CountryId, number>;
      for (const countryId of countryIds) {
        let value = 0;
        for (const { id, share } of regionShares.get(countryId) ?? []) {
          value += (regionalPop[id] ?? 0) * share;
        }
        countries[countryId] = value;
      }
      const continents = {} as Record<ContinentId, number>;
      for (const continent of continentMembers) {
        let value = 0;
        for (const { id, share } of continent.countryShares) {
          value += (countries[id] ?? 0) * share;
        }
        continents[continent.id] = value;
      }
      let world = 0;
      for (const { id, share } of continentShares) {
        world += (continents[id] ?? 0) * share;
      }
      const topCountry = highest(countries, countryIds);
      const topContinent = highest(continents, continentIds);
      return {
        world,
        continents,
        countries,
        top: topCountry === null ? null : { countryId: topCountry.id, value: topCountry.value },
        topContinent:
          topContinent === null
            ? null
            : { continentId: topContinent.id, value: topContinent.value },
      };
    },
  };
}

/** Highest value first, then by name, so a list reads from the strongest place down. */
function byValueThenName(
  left: { readonly value: number; readonly name: string },
  right: { readonly value: number; readonly name: string },
): number {
  return right.value - left.value || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function requireAggregate<Id extends string>(
  aggregates: ReadonlyMap<Id, Traced<number>>,
  id: Id,
): Traced<number> {
  const aggregate = aggregates.get(id);
  if (aggregate === undefined) {
    throw new InvalidArgumentError(
      'popularityRollupView',
      'rollup',
      id,
      'a roll-up built on the same map as the geography',
    );
  }
  return aggregate;
}

/**
 * A roll-up as plain JSON for a query result: world → continents → countries → regions, with each
 * derived level's trace inline, so a screen hands it straight to `Explained` and nothing is kept
 * in the trace store. Continents and countries are sorted by value (highest first, then by name),
 * regions by population. Every continent, country and region on the map is listed, 0 included.
 */
export function popularityRollupView(
  rollup: PopularityRollup,
  geography: Geography,
): PopularityRollupView {
  const continents = geography.continents.map((continent): PopularityContinentView => {
    const aggregate = requireAggregate(rollup.continents, continent.id);
    const countries = geography.countriesOf(continent.id).map((country): PopularityCountryView => {
      const countryAggregate = requireAggregate(rollup.countries, country.id);
      return {
        id: country.id,
        name: country.name,
        value: countryAggregate.value,
        trace: countryAggregate.trace,
        regions: geography.regionsOf(country.id).map((region) => ({
          id: region.id,
          name: region.name,
          population: region.population,
          value: rollup.regions.get(region.id) ?? 0,
        })),
      };
    });
    return {
      id: continent.id,
      name: continent.name,
      value: aggregate.value,
      trace: aggregate.trace,
      countries: countries.sort(byValueThenName),
    };
  });
  return {
    world: { value: rollup.world.value, trace: rollup.world.trace },
    continents: continents.sort(byValueThenName),
  };
}
