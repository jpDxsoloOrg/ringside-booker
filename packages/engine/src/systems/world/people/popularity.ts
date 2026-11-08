/**
 * Starting popularity: how well known a new person is, region by region.
 *
 * - **Home.** `reputation = stageBase + talentWeight × talent + variation`, kept between 0 and 90,
 *   where `stageBase` is `worldgen.popularity.stageBase.<stage>`, `talentWeight` is
 *   `worldgen.popularity.talentWeight` and the variation is a normal draw with spread
 *   `worldgen.popularity.noiseSd`, kept within 2.5 spreads. People who do not wrestle get
 *   `reputation × worldgen.popularity.nonPerformerFactor`. Their home region gets the reputation.
 * - **Away.** Every other region gets `reputation × spread × (1 + variation)`, where the spread is
 *   `countrySpread` for the rest of the home country, `neighbourSpread` for regions of other
 *   countries that border the home region, `continentSpread` for the rest of the continent and
 *   `worldSpread` for everywhere else, and the variation is uniform within
 *   `±worldgen.popularity.regionNoise`. A spread of 0 means no popularity there.
 * - **Sparse.** Values are rounded to one decimal and kept within 0-100; anything below
 *   `worldgen.popularity.storeFloor` (and every 0) is left out, so most people are known in only
 *   a handful of regions.
 *
 * Draws from the stream, in order: the home variation (2), then one variation per region other
 * than home, in region ID order (1 each). Every person draws the same amount.
 *
 * Design: docs/design/world-generation.md#popularity.
 */

import type { GameDate } from '../../../core/date';
import type { RegionId } from '../../../core/ids';
import { rollFloat, rollNormal, type RngStream } from '../../../core/rng';
import { inputOf, startCalc, traced, type TraceNode, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Region } from '../../../model/entities/geography';
import { WRESTLING_ROLES, type Person, type RegionalPop } from '../../../model/entities/person';
import type { CareerStage } from '../../../persistence/packs/records/generation';
import { createEngineTunables, type EngineTunables, type TunableKey } from '../../tunables';
import type { Geography } from '../geography';
import { formatNumber, STAGE_LABELS } from './labels';

const POPULARITY_DOC_REF = 'world-generation.md#popularity';

/** Highest starting reputation at home. */
export const REPUTATION_MAX = 90;

/** Highest stored popularity. */
const POPULARITY_MAX = 100;

/** The home variation is kept within this many spreads of 0. */
const NOISE_LIMIT_SPREADS = 2.5;

/** How a region relates to someone's home region. */
export type RegionRelation = 'home' | 'country' | 'neighbour' | 'continent' | 'world';

const RELATION_WORDS: Readonly<Record<Exclude<RegionRelation, 'home'>, string>> = {
  country: 'same country',
  neighbour: 'borders home',
  continent: 'same continent',
  world: 'another continent',
};

const SPREAD_KEYS: Readonly<Record<Exclude<RegionRelation, 'home'>, TunableKey>> = {
  country: 'worldgen.popularity.countrySpread',
  neighbour: 'worldgen.popularity.neighbourSpread',
  continent: 'worldgen.popularity.continentSpread',
  world: 'worldgen.popularity.worldSpread',
};

const STAGE_BASE_KEYS: Readonly<Record<CareerStage, TunableKey>> = {
  rookie: 'worldgen.popularity.stageBase.rookie',
  prospect: 'worldgen.popularity.stageBase.prospect',
  established: 'worldgen.popularity.stageBase.established',
  veteran: 'worldgen.popularity.stageBase.veteran',
  legend: 'worldgen.popularity.stageBase.legend',
};

/** How `region` relates to `home`: same region, same country, a border, same continent or not. */
export function regionRelation(geography: Geography, home: Region, region: Region): RegionRelation {
  if (region.id === home.id) {
    return 'home';
  }
  if (region.countryId === home.countryId) {
    return 'country';
  }
  if (home.neighbourRegionIds.includes(region.id)) {
    return 'neighbour';
  }
  const homeContinent = geography.country(home.countryId).continentId;
  return geography.country(region.countryId).continentId === homeContinent ? 'continent' : 'world';
}

/** One decimal place, the precision popularity is stored at. */
function toStored(value: number): number {
  return Math.min(POPULARITY_MAX, Math.round(value * 10) / 10);
}

/** What {@link seedPopularity} reads besides its arguments. */
export interface SeedPopularityOptions {
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
}

/** The starting reputation at home, traced. Draws two numbers from `stream`. */
export function homeReputation(
  person: Person,
  careerStage: CareerStage,
  talent: number,
  stream: RngStream,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc('Popularity at home', 0, {
    startLabel: 'Start',
    unit: 'points',
    docRef: POPULARITY_DOC_REF,
  });
  calc.add(
    `${STAGE_LABELS[careerStage]} starting point`,
    calc.tunable(tunables, STAGE_BASE_KEYS[careerStage]),
  );
  const talentWeight = calc.tunable(tunables, 'worldgen.popularity.talentWeight');
  calc.add(
    'Talent',
    talentWeight * talent,
    `${formatNumber(talentWeight)} × talent ${formatNumber(talent)}`,
  );
  const noiseSd = tunables.get('worldgen.popularity.noiseSd');
  const noiseLimit = noiseSd * NOISE_LIMIT_SPREADS;
  const noise = rollNormal(stream, 0, noiseSd, 'Popularity variation');
  const noiseValue = Math.min(noiseLimit, Math.max(-noiseLimit, noise.value));
  calc
    .roll({ ...noise.roll, min: -noiseLimit, max: noiseLimit, result: noiseValue })
    .add('Personal variation', noiseValue)
    .clamp(0, REPUTATION_MAX);
  const wrestles = person.roles.some((role) =>
    WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role),
  );
  if (!wrestles) {
    calc.multiply(
      'Does not wrestle',
      calc.tunable(tunables, 'worldgen.popularity.nonPerformerFactor'),
    );
  }
  return calc.done();
}

/**
 * Seeds `regionalPop` for `person`, who is from `person.basedInRegionId`. Pure: the same person,
 * stage, talent, map, tunables and stream state always give the same map. See the module comment.
 */
export function seedPopularity(
  person: Person,
  careerStage: CareerStage,
  talent: number,
  worldDate: GameDate,
  stream: RngStream,
  geo: Geography,
  options: SeedPopularityOptions = {},
): Traced<RegionalPop> {
  const tunables = options.tunables ?? createEngineTunables();
  const home = geo.region(person.basedInRegionId);
  const reputation = homeReputation(person, careerStage, talent, stream, tunables);
  const floor = tunables.get('worldgen.popularity.storeFloor');
  const regionNoise = tunables.get('worldgen.popularity.regionNoise');
  const spreads: Readonly<Record<Exclude<RegionRelation, 'home'>, number>> = {
    country: tunables.get(SPREAD_KEYS.country),
    neighbour: tunables.get(SPREAD_KEYS.neighbour),
    continent: tunables.get(SPREAD_KEYS.continent),
    world: tunables.get(SPREAD_KEYS.world),
  };
  const keep = (value: number): boolean => value > 0 && value >= floor;

  const regionalPop: RegionalPop = {};
  const regionSteps: TraceNode[] = [];
  let leftOut = 0;
  const homeValue = toStored(reputation.value);
  if (keep(homeValue)) {
    regionalPop[home.id] = homeValue;
    regionSteps.push(
      inputOf(`${home.name} (home)`, homeValue, { kind: 'region', id: home.id }, 'points').trace,
    );
  } else {
    leftOut += 1;
  }
  for (const region of geo.regions) {
    if (region.id === home.id) {
      continue;
    }
    const relation = regionRelation(geo, home, region);
    const variation = rollFloat(stream, -regionNoise, regionNoise, `${region.name} variation`);
    if (relation === 'home') {
      continue;
    }
    const value = toStored(reputation.value * spreads[relation] * (1 + variation.value));
    if (!keep(value)) {
      leftOut += 1;
      continue;
    }
    const regionId: RegionId = region.id;
    regionalPop[regionId] = value;
    regionSteps.push({
      kind: 'input',
      label: `${region.name} (${RELATION_WORDS[relation]})`,
      value,
      unit: 'points',
      ref: { kind: 'region', id: region.id },
      children: [
        {
          kind: 'note',
          label: `${formatNumber(reputation.value)} × ${formatNumber(spreads[relation])} × (1 ${variation.value < 0 ? '−' : '+'} ${formatNumber(Math.abs(variation.value))})`,
          value: null,
        },
      ],
    });
  }
  const stored = Object.keys(regionalPop).length;
  const root: TraceNode = {
    kind: 'input',
    label: 'Regional popularity',
    value: `Known in ${String(stored)} ${stored === 1 ? 'region' : 'regions'}`,
    docRef: POPULARITY_DOC_REF,
    children: [
      inputOf('On', worldDate).trace,
      reputation.trace,
      tunableNode(tunables, SPREAD_KEYS.country),
      tunableNode(tunables, SPREAD_KEYS.neighbour),
      tunableNode(tunables, SPREAD_KEYS.continent),
      tunableNode(tunables, SPREAD_KEYS.world),
      tunableNode(tunables, 'worldgen.popularity.regionNoise'),
      tunableNode(tunables, 'worldgen.popularity.storeFloor'),
      ...regionSteps,
      {
        kind: 'note',
        label: `${String(leftOut)} ${leftOut === 1 ? 'region' : 'regions'} below the floor, left out (unknown there)`,
        value: null,
      },
    ],
  };
  return traced(regionalPop, root);
}
