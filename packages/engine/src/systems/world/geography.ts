/**
 * Geography queries: walking the continent → country → region hierarchy, rolling per-region values
 * up to countries and continents, and picking a region by weight.
 *
 * Popularity and everything else that depends on place is stored per region only (design decision
 * D-03). Countries and continents are population-weighted means of their regions, worked out here
 * when a screen or a coarse check needs them, so there is never a second copy to keep in sync.
 *
 * Design: docs/design/geography.md.
 */

import type { ContinentId, CountryId, RegionId } from '../../core/ids';
import { InvalidArgumentError } from '../../core/errors';
import { fastPathsEnabled } from '../../core/fastPaths';
import { weightedPick, type RngStream } from '../../core/rng';
import { inputOf, startCalc, type Calc, type Traced, type TraceUnit } from '../../core/trace';
import {
  continentsTable,
  countriesTable,
  regionsTable,
  type Continent,
  type Country,
  type Region,
} from '../../model/entities/geography';
import { tableOf, type WorldView } from '../../model/world';

/** The design doc section the aggregation traces point at. */
const AGGREGATION_DOC_REF = 'geography.md#aggregation';

/** The map's rows, as read from a world or built by hand in a test. */
export interface GeographySource {
  readonly continents: readonly Continent[];
  readonly countries: readonly Country[];
  readonly regions: readonly Region[];
}

/** How an aggregate's trace labels and measures its numbers. */
export interface AggregateOptions {
  /** What the values are, for trace labels: "Popularity" gives "Popularity in Japan". */
  readonly valueLabel?: string;
  /** The values' unit, recorded on the trace. */
  readonly unit?: TraceUnit;
}

/** Read-only lookups over one map. Every list comes back in a fixed order. */
export interface Geography {
  readonly continents: readonly Continent[];
  readonly countries: readonly Country[];
  readonly regions: readonly Region[];
  /** The continent with this ID. Throws `InvalidArgumentError` for an unknown ID. */
  continent(continentId: ContinentId): Continent;
  /** The country with this ID. Throws `InvalidArgumentError` for an unknown ID. */
  country(countryId: CountryId): Country;
  /** The region with this ID. Throws `InvalidArgumentError` for an unknown ID. */
  region(regionId: RegionId): Region;
  /** A country's regions, most populous first (ties by ID). Empty for an unknown country. */
  regionsOf(countryId: CountryId): readonly Region[];
  /** A continent's countries, most populous first (ties by ID). Empty for an unknown continent. */
  countriesOf(continentId: ContinentId): readonly Country[];
  /** The country a region is in. */
  countryOf(regionId: RegionId): Country;
  /** The continent a region is in. */
  continentOf(regionId: RegionId): Continent;
  /**
   * Every country's population-weighted mean of `values`, with a trace that lists each region's
   * value and population share. Regions missing from `values` count as 0.
   */
  aggregateByCountry(
    values: ReadonlyMap<RegionId, number>,
    options?: AggregateOptions,
  ): Map<CountryId, Traced<number>>;
  /**
   * Every continent's population-weighted mean of `values`: each country's aggregate weighted by
   * the country's share of the continent's population. Regions missing from `values` count as 0.
   */
  aggregateByContinent(
    values: ReadonlyMap<RegionId, number>,
    options?: AggregateOptions,
  ): Map<ContinentId, Traced<number>>;
  /**
   * The whole map's population-weighted mean of `values`: each continent's aggregate weighted by
   * the continent's share of the world's population. Regions missing from `values` count as 0.
   * The trace lists the continents and, inside each, its countries as single lines; a country's
   * regions are in that country's own aggregate.
   */
  aggregateWorld(values: ReadonlyMap<RegionId, number>, options?: AggregateOptions): Traced<number>;
  /** One country's entry of {@link Geography.aggregateByCountry}, without working out the rest. */
  aggregateCountry(
    countryId: CountryId,
    values: ReadonlyMap<RegionId, number>,
    options?: AggregateOptions,
  ): Traced<number>;
  /** One continent's entry of {@link Geography.aggregateByContinent}, without the rest. */
  aggregateContinent(
    continentId: ContinentId,
    values: ReadonlyMap<RegionId, number>,
    options?: AggregateOptions,
  ): Traced<number>;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Most populous first, then by ID, so a "Why?" panel lists the biggest contributors first. */
function byPopulation<Row extends { readonly id: string; readonly population: number }>(
  left: Row,
  right: Row,
): number {
  return right.population - left.population || compareIds(left.id, right.id);
}

function groupBy<Row, Key>(rows: readonly Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

function requireRow<Id extends string, Row>(
  rows: ReadonlyMap<Id, Row>,
  id: Id,
  functionName: string,
  what: string,
): Row {
  const row = rows.get(id);
  if (row === undefined) {
    throw new InvalidArgumentError(functionName, 'id', id, `the ID of a ${what} on the map`);
  }
  return row;
}

function formatPercent(share: number): string {
  return `${(share * 100).toFixed(1)}% of the population`;
}

/** One weighted part of a mean: `value × share`, as a sub-calculation. */
interface WeightedPart {
  readonly label: string;
  readonly value: Traced<number>;
  readonly share: number;
  readonly reason: string;
}

/**
 * A population-weighted mean: start at 0 and add each part's `value × share`. When every part has
 * no population, the parts share equally and a note says so.
 */
function weightedMean(
  label: string,
  parts: readonly {
    readonly label: string;
    readonly value: Traced<number>;
    readonly population: number;
  }[],
  options: AggregateOptions,
  emptyNote: string,
): Traced<number> {
  const calc: Calc = startCalc(label, 0, {
    startLabel: 'Start',
    docRef: AGGREGATION_DOC_REF,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
  });
  if (parts.length === 0) {
    return calc.note(emptyNote).done();
  }
  const totalPopulation = parts.reduce((sum, part) => sum + part.population, 0);
  if (totalPopulation === 0) {
    calc.note('Nobody lives here, so every part counts equally');
  }
  const weighted: WeightedPart[] = parts.map((part) => {
    const share = totalPopulation === 0 ? 1 / parts.length : part.population / totalPopulation;
    return { label: part.label, value: part.value, share, reason: formatPercent(share) };
  });
  for (const part of weighted) {
    const contribution = startCalc(part.label, part.value)
      .multiply(
        'Share of population',
        inputOf('Share of population', part.share, undefined, 'ratio'),
      )
      .done();
    calc.add(part.label, contribution, part.reason);
  }
  return calc.done();
}

/** Builds the lookups for one map. The rows are copied, so later changes to the arrays don't leak in. */
export function createGeography(source: GeographySource): Geography {
  const continents = [...source.continents].sort((left, right) => compareIds(left.id, right.id));
  const countries = [...source.countries].sort((left, right) => compareIds(left.id, right.id));
  const regions = [...source.regions].sort((left, right) => compareIds(left.id, right.id));

  const continentById = new Map(continents.map((continent) => [continent.id, continent]));
  const countryById = new Map(countries.map((country) => [country.id, country]));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const regionsByCountry = groupBy(regions, (region) => region.countryId);
  const countriesByContinent = groupBy(countries, (country) => country.continentId);
  for (const group of [...regionsByCountry.values(), ...countriesByContinent.values()]) {
    group.sort(byPopulation);
  }

  const regionsOf = (countryId: CountryId): readonly Region[] =>
    regionsByCountry.get(countryId) ?? [];
  const countriesOf = (continentId: ContinentId): readonly Country[] =>
    countriesByContinent.get(continentId) ?? [];
  const country = (countryId: CountryId): Country =>
    requireRow(countryById, countryId, 'Geography.country', 'country');
  const continent = (continentId: ContinentId): Continent =>
    requireRow(continentById, continentId, 'Geography.continent', 'continent');
  const region = (regionId: RegionId): Region =>
    requireRow(regionById, regionId, 'Geography.region', 'region');
  const countryOf = (regionId: RegionId): Country => country(region(regionId).countryId);
  const continentOf = (regionId: RegionId): Continent => continent(countryOf(regionId).continentId);

  /** A country's people as its regions count them, which is what the means weigh by. */
  const regionPopulation = (countryId: CountryId): number =>
    regionsOf(countryId).reduce((sum, row) => sum + row.population, 0);

  const countryAggregate = (
    target: Country,
    values: ReadonlyMap<RegionId, number>,
    options: AggregateOptions,
  ): Traced<number> => {
    const valueLabel = options.valueLabel ?? 'Value';
    const parts = regionsOf(target.id).map((row) => {
      const value = values.get(row.id);
      const inputLabel =
        value === undefined
          ? `${valueLabel} in ${row.name} (none, counts as 0)`
          : `${valueLabel} in ${row.name}`;
      return {
        label: row.name,
        value: inputOf(inputLabel, value ?? 0, { kind: 'region', id: row.id }, options.unit),
        population: row.population,
      };
    });
    return weightedMean(`${valueLabel} in ${target.name}`, parts, options, 'No regions, so 0');
  };

  /** A continent's people: the sum of its countries' region populations. */
  const continentPopulation = (continentId: ContinentId): number =>
    countriesOf(continentId).reduce((sum, row) => sum + regionPopulation(row.id), 0);

  /** Continents, most populous first (ties by ID), the order the world's trace lists them in. */
  const continentsByPopulation = continents
    .map((row) => ({ id: row.id, row, population: continentPopulation(row.id) }))
    .sort(byPopulation);

  /**
   * A continent's mean. With `countryDetail` each country line holds that country's own trace,
   * down to its regions. Without it a country is a single input line, which is how the world's
   * trace lists them: on the shipped map the full tree of every continent, country and region
   * would not fit one trace, and the last continents would be cut from the explanation.
   */
  const continentAggregate = (
    target: Continent,
    values: ReadonlyMap<RegionId, number>,
    options: AggregateOptions,
    countryDetail: boolean,
  ): Traced<number> => {
    const valueLabel = options.valueLabel ?? 'Value';
    const parts = countriesOf(target.id).map((member) => {
      const aggregate = countryAggregate(member, values, options);
      return {
        label: member.name,
        value: countryDetail
          ? aggregate
          : inputOf(
              `${valueLabel} in ${member.name}`,
              aggregate.value,
              { kind: 'country', id: member.id },
              options.unit,
            ),
        population: regionPopulation(member.id),
      };
    });
    return weightedMean(`${valueLabel} in ${target.name}`, parts, options, 'No countries, so 0');
  };

  return {
    continents,
    countries,
    regions,
    continent,
    country,
    region,
    regionsOf,
    countriesOf,
    countryOf,
    continentOf,
    aggregateByCountry(values, options = {}) {
      const result = new Map<CountryId, Traced<number>>();
      for (const row of countries) {
        result.set(row.id, countryAggregate(row, values, options));
      }
      return result;
    },
    aggregateByContinent(values, options = {}) {
      const result = new Map<ContinentId, Traced<number>>();
      for (const row of continents) {
        result.set(row.id, continentAggregate(row, values, options, true));
      }
      return result;
    },
    aggregateWorld(values, options = {}) {
      const valueLabel = options.valueLabel ?? 'Value';
      const parts = continentsByPopulation.map((entry) => ({
        label: entry.row.name,
        value: continentAggregate(entry.row, values, options, false),
        population: entry.population,
      }));
      return weightedMean(`${valueLabel} worldwide`, parts, options, 'No continents, so 0');
    },
    aggregateCountry(countryId, values, options = {}) {
      return countryAggregate(country(countryId), values, options);
    },
    aggregateContinent(continentId, values, options = {}) {
      return continentAggregate(continent(continentId), values, options, true);
    },
  };
}

/** The last map {@link geographyOf} built, with the rows it was built from. */
let lastGeography: (GeographySource & { readonly geography: Geography }) | null = null;

/** True when both lists hold the very same row objects in the same order. */
function sameRows<Row>(left: readonly Row[], right: readonly Row[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * The map of a world: its continents, countries and regions tables.
 *
 * Fast path (POL4-10): the map almost never changes, and rows are never changed in place (an
 * update makes a new row), so when every row is the same object as last time the map built then
 * is handed back instead of being built again. Docs: docs/design/day-pipeline.md#fast-paths.
 */
export function geographyOf(view: WorldView): Geography {
  const source: GeographySource = {
    continents: tableOf(view, continentsTable).values(),
    countries: tableOf(view, countriesTable).values(),
    regions: tableOf(view, regionsTable).values(),
  };
  if (!fastPathsEnabled()) {
    return createGeography(source);
  }
  const last = lastGeography;
  if (
    last !== null &&
    sameRows(last.regions, source.regions) &&
    sameRows(last.countries, source.countries) &&
    sameRows(last.continents, source.continents)
  ) {
    return last.geography;
  }
  const geography = createGeography(source);
  lastGeography = { ...source, geography };
  return geography;
}

/**
 * How much a region counts when something is spread over the map by audience, such as where a new
 * wrestler is from: `population × interest / 100`. The region's interest is already its effective
 * value, because the pack loader copies the country's interest into regions that don't set one.
 */
export function regionWeight(region: Pick<Region, 'population' | 'wrestlingInterest'>): number {
  return (region.population * region.wrestlingInterest) / 100;
}

/**
 * One of `candidates`, chosen with odds `weightFn(region) / total` in a single draw from `stream`
 * (see `weightedPick`). Zero-weight regions are never chosen.
 *
 * @throws InvalidOddsError when there are no candidates, a weight is negative or not finite, or
 *   every weight is 0.
 */
export function pickRegion<Candidate extends Region>(
  stream: RngStream,
  candidates: readonly Candidate[],
  weightFn: (region: Candidate) => number,
): Candidate {
  return weightedPick(
    stream,
    candidates.map((candidate) => ({ item: candidate, weight: weightFn(candidate) })),
  );
}
