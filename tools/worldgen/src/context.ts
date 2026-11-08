/**
 * The build context: the organisations loaded through the pack loader, the map, the people
 * generator, the RNG and the key ↔ ID lookups every step needs.
 */

import {
  geographyOf,
  loadWorldFromPacks,
  packs,
  parseId,
  PersonGenerator,
  RngRegistry,
  type ContentLibrary,
  type ContinentId,
  type CountryId,
  type GameDate,
  type Geography,
  type PersonId,
  type RegionId,
  type RngStream,
  type StreamName,
} from '@ringside/engine';
import './streams';
import { WORLD_PACK_ID, type BuildInputs } from './content';
import type { RosterPromotion, RosterTitle } from './model';
import type { RosterSpec } from './specSchema';
import { compareText } from './stats';

/** Crockford base32, the alphabet engine ID bodies use. */
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_BODY_LENGTH = 10;

export interface BuildContext {
  readonly spec: RosterSpec;
  readonly startDate: GameDate;
  readonly library: ContentLibrary;
  readonly geography: Geography;
  readonly generator: PersonGenerator;
  readonly rng: RngRegistry;
  readonly promotions: ReadonlyMap<string, RosterPromotion>;
  /** Every title, sorted by key. */
  readonly titles: readonly RosterTitle[];
  readonly regionId: (key: string) => RegionId;
  readonly regionKey: (id: RegionId) => string;
  readonly countryId: (key: string) => CountryId;
  readonly continentId: (key: string) => ContinentId;
  /** A fresh person ID for the generator; IDs never reach the output. */
  readonly nextPersonId: () => PersonId;
  readonly stream: (name: StreamName) => RngStream;
}

/** Raised when the content the build reads does not fit the spec. */
export class RosterBuildError extends Error {
  override readonly name = 'RosterBuildError';
}

function lookup<Value>(map: ReadonlyMap<string, Value>, key: string, what: string): Value {
  const value = map.get(key);
  if (value === undefined) {
    throw new RosterBuildError(`Unknown ${what}: ${key}`);
  }
  return value;
}

function encodeIdBody(value: number): string {
  let remaining = value;
  let body = '';
  for (let i = 0; i < ID_BODY_LENGTH; i++) {
    body = `${ID_ALPHABET[remaining % ID_ALPHABET.length] ?? '0'}${body}`;
    remaining = Math.floor(remaining / ID_ALPHABET.length);
  }
  return body;
}

/** Loads the organisations and sets up everything the build steps share. */
export function createBuildContext(inputs: BuildInputs): BuildContext {
  const { spec } = inputs;
  const resolved = packs.resolvePacks(inputs.packs, [WORLD_PACK_ID]);
  if (!resolved.ok) {
    throw new RosterBuildError(
      `The packs did not resolve: ${resolved.issues.map(packs.formatPackIssue).join('; ')}`,
    );
  }
  const merged = packs.mergeRecords(resolved.value);
  if (!merged.ok) {
    throw new RosterBuildError(
      `The packs did not merge: ${merged.issues.map(packs.formatPackIssue).join('; ')}`,
    );
  }
  const loaded = loadWorldFromPacks(inputs.packs, [WORLD_PACK_ID], { seed: spec.seed });
  if (!loaded.ok) {
    throw new RosterBuildError(
      `The organisations did not load: ${loaded.issues.map(packs.formatPackIssue).join('; ')}`,
    );
  }
  const { world, library } = loaded.value;
  const startDate = world.meta.startDate;
  const contentKeys = world.meta.contentKeys;

  const regionIds = new Map<string, RegionId>();
  const regionKeys = new Map<string, string>();
  for (const [key, id] of Object.entries(contentKeys['region'] ?? {})) {
    const regionId = parseId('region', id);
    regionIds.set(key, regionId);
    regionKeys.set(regionId, key);
  }
  const countryIds = new Map<string, CountryId>(
    Object.entries(contentKeys['country'] ?? {}).map(([key, id]) => [key, parseId('country', id)]),
  );
  const continentIds = new Map<string, ContinentId>(
    Object.entries(contentKeys['continent'] ?? {}).map(([key, id]) => [
      key,
      parseId('continent', id),
    ]),
  );

  const promotions = new Map<string, RosterPromotion>();
  for (const [key, mergedPromotion] of [...merged.value.records.promotion.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const record = mergedPromotion.record;
    const promotionSpec = spec.promotions[key];
    if (promotionSpec === undefined) {
      throw new RosterBuildError(`Promotion ${key} has no entry in the roster spec`);
    }
    const regionalPop: Record<string, number> = {};
    for (const [ref, value] of Object.entries(record.regionalPop)) {
      regionalPop[packs.parseRef(packs.refSchema.parse(ref)).key] = value;
    }
    promotions.set(key, {
      key,
      tier: promotionSpec.tier,
      homeRegionKey: packs.parseRef(record.homeRegionKey).key,
      regionalPop,
    });
  }
  for (const key of Object.keys(spec.promotions)) {
    if (!promotions.has(key)) {
      throw new RosterBuildError(`The roster spec names promotion ${key}, which the world lacks`);
    }
  }

  const titles: RosterTitle[] = [...merged.value.records.title.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .filter(([, mergedTitle]) => mergedTitle.record.status === 'active')
    .map(([key, mergedTitle]) => {
      const record = mergedTitle.record;
      const brandRef = record.brandKey ?? null;
      return {
        key,
        promotionKey: packs.parseRef(record.promotionKey).key,
        brandKey: brandRef === null ? null : packs.parseRef(brandRef).key,
        holderCount: record.holderCount,
        gender: record.division.gender,
        minWeightKg: record.division.minWeightKg,
        maxWeightKg: record.division.maxWeightKg,
        introducedOn: record.introducedOn,
      };
    });

  const rng = new RngRegistry(spec.seed);
  let personCounter = 0;
  return {
    spec,
    startDate,
    library,
    geography: geographyOf(world),
    generator: PersonGenerator.forWorld(world, library),
    rng,
    promotions,
    titles,
    regionId: (key) => lookup(regionIds, key, 'region'),
    regionKey: (id) => lookup(regionKeys, id, 'region ID'),
    countryId: (key) => lookup(countryIds, key, 'country'),
    continentId: (key) => lookup(continentIds, key, 'continent'),
    nextPersonId: () => {
      personCounter += 1;
      return parseId('person', `per_${encodeIdBody(personCounter)}`);
    },
    stream: (name) => rng.stream(name),
  };
}
