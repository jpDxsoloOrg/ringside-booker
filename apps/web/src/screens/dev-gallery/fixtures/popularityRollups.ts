/**
 * Hand-written popularity roll-ups for the PopularityDrilldown demo and tests: a small map of
 * three continents and three made-up subjects. Nothing here calls the engine. The traces are
 * built in the shape the engine's roll-up gives (docs/design/geography.md#aggregation): a country
 * adds each region's value times its population share, a continent does the same with its
 * countries, and the world lists the continents with each country as one line.
 */
import { parseId } from '@ringside/engine';
import type {
  ContinentId,
  PopularityContinentView,
  PopularityCountryView,
  PopularityRegionView,
  PopularityRollupView,
  TraceNode,
} from '@ringside/engine';

const DOC_REF = 'geography.md#aggregation';
const UNIT = 'points';
const MILLION = 1_000_000;

interface RegionPlace {
  readonly key: string;
  readonly name: string;
  /** In millions of people. */
  readonly population: number;
}

interface CountryPlace {
  readonly name: string;
  readonly regions: readonly RegionPlace[];
}

interface ContinentPlace {
  readonly name: string;
  readonly countries: readonly CountryPlace[];
}

/** The demo map. Real place names, round populations. */
const MAP: readonly ContinentPlace[] = [
  {
    name: 'North America',
    countries: [
      {
        name: 'United States',
        regions: [
          { key: 'us-southeast', name: 'Southeast', population: 60 },
          { key: 'us-texas', name: 'Texas', population: 30 },
          { key: 'us-northeast', name: 'Northeast', population: 50 },
        ],
      },
      {
        name: 'Canada',
        regions: [
          { key: 'ca-ontario', name: 'Ontario', population: 15 },
          { key: 'ca-quebec', name: 'Quebec', population: 9 },
        ],
      },
    ],
  },
  {
    name: 'Asia',
    countries: [
      {
        name: 'Japan',
        regions: [
          { key: 'jp-kanto', name: 'Kanto', population: 44 },
          { key: 'jp-kansai', name: 'Kansai', population: 22 },
        ],
      },
      {
        name: 'South Korea',
        regions: [{ key: 'kr-all', name: 'South Korea', population: 52 }],
      },
    ],
  },
  {
    name: 'Europe',
    countries: [
      {
        name: 'United Kingdom',
        regions: [
          { key: 'uk-london', name: 'London', population: 9 },
          { key: 'uk-north', name: 'Northern England', population: 15 },
        ],
      },
      {
        name: 'Ireland',
        regions: [{ key: 'ie-all', name: 'Ireland', population: 5 }],
      },
    ],
  },
];

/** IDs are a prefix and ten characters; the demo numbers its places in map order. */
const ID_DIGITS = 10;

function sequenceSuffix(index: number): string {
  return String(index + 1).padStart(ID_DIGITS, '0');
}

interface WeightedPart {
  readonly name: string;
  readonly population: number;
  /** The part's own value: an input line, or a nested formula. */
  readonly source: TraceNode;
  readonly value: number;
}

function sharePercent(share: number): string {
  return `${(share * 100).toFixed(1)}% of the population`;
}

/** A population-weighted mean as the engine traces it: start at 0, add each `value × share`. */
function weightedMeanTrace(
  label: string,
  parts: readonly WeightedPart[],
): { value: number; trace: TraceNode } {
  const total = parts.reduce((sum, part) => sum + part.population, 0);
  let running = 0;
  const steps: TraceNode[] = parts.map((part) => {
    const share = part.population / total;
    const contribution = part.value * share;
    const before = running;
    running += contribution;
    return {
      kind: 'add',
      label: part.name,
      value: running,
      operand: contribution,
      before,
      after: running,
      reason: sharePercent(share),
      children: [
        {
          kind: 'formula',
          label: part.name,
          value: contribution,
          children: [
            part.source,
            {
              kind: 'multiply',
              label: 'Share of population',
              value: contribution,
              operand: share,
              before: part.value,
              after: contribution,
              children: [
                { kind: 'input', label: 'Share of population', value: share, unit: 'ratio' },
              ],
            },
          ],
        },
      ],
    };
  });
  return {
    value: running,
    trace: {
      kind: 'formula',
      label,
      value: running,
      unit: UNIT,
      docRef: DOC_REF,
      children: [{ kind: 'input', label: 'Start', value: 0, unit: UNIT }, ...steps],
    },
  };
}

function byValueThenName(
  left: { readonly value: number; readonly name: string },
  right: { readonly value: number; readonly name: string },
): number {
  return right.value - left.value || left.name.localeCompare(right.name);
}

/**
 * The view of one subject. `popularity` is per region key, as the game stores it: a region that is
 * left out has no fans.
 */
function rollupViewOf(popularity: Readonly<Record<string, number>>): PopularityRollupView {
  let regionIndex = 0;
  let countryIndex = 0;
  const worldParts: WeightedPart[] = [];

  const continents = MAP.map((continentPlace, continentIndex): PopularityContinentView => {
    const countryParts: WeightedPart[] = [];
    const countrySummaries: WeightedPart[] = [];
    const countries = continentPlace.countries.map((countryPlace): PopularityCountryView => {
      const countryId = parseId('country', `cty_${sequenceSuffix(countryIndex)}`);
      countryIndex += 1;
      const orderedRegions = [...countryPlace.regions].sort(
        (left, right) => right.population - left.population,
      );
      const regions = orderedRegions.map((regionPlace): PopularityRegionView => {
        const id = parseId('region', `reg_${sequenceSuffix(regionIndex)}`);
        regionIndex += 1;
        return {
          id,
          name: regionPlace.name,
          population: regionPlace.population * MILLION,
          value: popularity[regionPlace.key] ?? 0,
        };
      });
      const { value, trace } = weightedMeanTrace(
        `Popularity in ${countryPlace.name}`,
        regions.map((region, index) => ({
          name: region.name,
          population: region.population,
          value: region.value,
          source: {
            kind: 'input',
            label:
              popularity[orderedRegions[index]?.key ?? ''] === undefined
                ? `Popularity in ${region.name} (none, counts as 0)`
                : `Popularity in ${region.name}`,
            value: region.value,
            unit: UNIT,
            ref: { kind: 'region', id: region.id },
          },
        })),
      );
      const population = regions.reduce((sum, region) => sum + region.population, 0);
      countryParts.push({ name: countryPlace.name, population, value, source: trace });
      countrySummaries.push({
        name: countryPlace.name,
        population,
        value,
        source: {
          kind: 'input',
          label: `Popularity in ${countryPlace.name}`,
          value,
          unit: UNIT,
          ref: { kind: 'country', id: countryId },
        },
      });
      return { id: countryId, name: countryPlace.name, value, trace, regions };
    });

    const label = `Popularity in ${continentPlace.name}`;
    const { value, trace } = weightedMeanTrace(label, countryParts);
    worldParts.push({
      name: continentPlace.name,
      population: countryParts.reduce((sum, part) => sum + part.population, 0),
      value,
      // In the world's breakdown a country is one line; its regions are in its own Why?.
      source: weightedMeanTrace(label, countrySummaries).trace,
    });
    return {
      id: parseId('continent', `ctn_${sequenceSuffix(continentIndex)}`),
      name: continentPlace.name,
      value,
      trace,
      countries: countries.sort(byValueThenName),
    };
  });

  const world = weightedMeanTrace(
    'Popularity worldwide',
    [...worldParts].sort((left, right) => right.population - left.population),
  );
  return { world, continents: continents.sort(byValueThenName) };
}

/** A local hero: known in two regions of one country and nowhere else. */
export const LOCAL_HERO_NAME = 'Dusty Marlowe';
export const localHeroRollup: PopularityRollupView = rollupViewOf({
  'us-southeast': 62,
  'us-texas': 18,
});

/** A global star: fans on every continent, strongest at home in Japan. */
export const GLOBAL_STAR_NAME = 'Kenji Arashi';
export const globalStarRollup: PopularityRollupView = rollupViewOf({
  'jp-kanto': 94,
  'jp-kansai': 88,
  'kr-all': 41,
  'us-southeast': 35,
  'us-texas': 52,
  'us-northeast': 68,
  'ca-ontario': 44,
  'ca-quebec': 30,
  'uk-london': 71,
  'uk-north': 49,
  'ie-all': 38,
});

/** A rookie with no fans anywhere: every level is 0. */
export const UNKNOWN_ROOKIE_NAME = 'Pip Calloway';
export const unknownRookieRollup: PopularityRollupView = rollupViewOf({});

/** The first continent of a roll-up, for a demo that starts with one open. */
export function firstContinentId(rollup: PopularityRollupView): ContinentId[] {
  const [first] = rollup.continents;
  return first === undefined ? [] : [first.id];
}
