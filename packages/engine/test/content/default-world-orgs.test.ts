// The shipped default world's organisations (WLD-08): promotions, brands, titles, venues, networks,
// deals and event definitions. Design: docs/design/default-world.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  coveredRegionIds,
  geographyOf,
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type EventImportance,
  type LoadedWorld,
  type Promotion,
  type PromotionId,
  type RawPack,
  type RecordKind,
  type RegionId,
} from '@ringside/engine';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../content/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
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

/** Main-card slots by importance; the starting values in docs/design/default-world.md. */
const SLOTS_BY_IMPORTANCE: Readonly<Record<EventImportance, number>> = {
  house: 5,
  minor: 5,
  regular: 6,
  major: 8,
  flagship: 10,
};

/** The promotion slots of each size tier, biggest tier first. */
const TIERS: readonly (readonly string[])[] = [
  ['pro-flagship'],
  ['pro-jp-major', 'pro-mx-major'],
  ['pro-us-southeast', 'pro-us-greatlakes', 'pro-us-west-women', 'pro-ca', 'pro-uk', 'pro-de'],
  ['pro-us-texas-indie', 'pro-jp-kansai-indie', 'pro-au-indie'],
];

const REGIONAL_SLOTS = TIERS[2] ?? [];

const loaded = loadWorldFromPacks(
  [readContentPack('base'), readContentPack('worlds/default')],
  ['default-world'],
  { seed: 'default-world-orgs' },
);

function loadedWorld(): LoadedWorld {
  if (!loaded.ok) {
    throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value;
}

/** The promotion the loader made from a promotion slot key. */
function promotionOf(key: string): Promotion {
  const { world } = loadedWorld();
  const mintedId = world.meta.contentKeys['promotion']?.[key];
  const promotion = world.tables.promotions.values().find((row) => row.id === mintedId);
  if (promotion === undefined) {
    throw new Error(`No promotion with key ${key}`);
  }
  return promotion;
}

/** The engine ID the loader minted for a promotion slot key. */
function promotionIdOf(key: string): PromotionId {
  return promotionOf(key).id;
}

describe('the default world organisations', () => {
  it('loads with base, with no errors and no warnings', () => {
    expect(loaded.issues).toEqual([]);
    expect(loaded.ok).toBe(true);
  });

  it('has 12 active promotions covering at least 6 countries on at least 4 continents', () => {
    const { world } = loadedWorld();
    const geography = geographyOf(world);
    const promotions = world.tables.promotions.values();
    expect(promotions).toHaveLength(12);
    expect(promotions.every((promotion) => promotion.status === 'active')).toBe(true);
    const countries = new Set(
      promotions.map((promotion) => geography.countryOf(promotion.homeRegionId).id),
    );
    const continents = new Set(
      promotions.map((promotion) => geography.continentOf(promotion.homeRegionId).id),
    );
    expect(countries.size).toBeGreaterThanOrEqual(6);
    expect(continents.size).toBeGreaterThanOrEqual(4);
    expect(TIERS.flat().map(promotionIdOf)).toHaveLength(12);
  });

  it('gives every promotion an active title, an event and a venue in its home country', () => {
    const { world } = loadedWorld();
    const geography = geographyOf(world);
    const venueCountries = new Set(
      world.tables.venues.values().map((venue) => geography.countryOf(venue.regionId).id),
    );
    for (const promotion of world.tables.promotions.values()) {
      const homeCountry = geography.countryOf(promotion.homeRegionId).id;
      const titles = world.tables.titles
        .values()
        .filter((title) => title.promotionId === promotion.id && title.status === 'active');
      const events = world.tables.eventDefinitions
        .values()
        .filter((definition) => definition.promotionId === promotion.id);
      expect(titles.length, promotion.name).toBeGreaterThanOrEqual(1);
      expect(events.length, promotion.name).toBeGreaterThanOrEqual(1);
      expect(venueCountries.has(homeCountry), promotion.name).toBe(true);
      const homeVenues = events.filter((definition) => {
        const venueId = definition.preferredVenueId;
        const venue = venueId === null ? undefined : world.tables.venues.get(venueId);
        return venue !== undefined && geography.countryOf(venue.regionId).id === homeCountry;
      });
      expect(homeVenues.length, promotion.name).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives the flagship two brands, each with at least one event definition', () => {
    const { world } = loadedWorld();
    const flagshipId = promotionIdOf('pro-flagship');
    const brands = world.tables.brands.values();
    expect(brands).toHaveLength(2);
    expect(brands.every((brand) => brand.promotionId === flagshipId)).toBe(true);
    for (const brand of brands) {
      expect(brand.controller).toBeNull();
      const events = world.tables.eventDefinitions
        .values()
        .filter((definition) => definition.brandId === brand.id);
      expect(events.length, brand.name).toBeGreaterThanOrEqual(1);
    }
  });

  it('sizes every show from the importance table, with pre-shows only on major and flagship cards', () => {
    const { world } = loadedWorld();
    for (const definition of world.tables.eventDefinitions.values()) {
      expect(definition.format.slots, definition.name).toBe(
        SLOTS_BY_IMPORTANCE[definition.importance],
      );
      if (definition.importance !== 'major' && definition.importance !== 'flagship') {
        expect(definition.format.preShowSlots, definition.name).toBe(0);
      }
    }
  });

  it('schedules recurring shows by rule, never by a dates list, and runs a fortnightly regional', () => {
    const { world } = loadedWorld();
    const definitions = world.tables.eventDefinitions.values();
    expect(definitions.filter((definition) => definition.recurrence.kind === 'dates')).toEqual([]);
    const regionalIds = new Set(REGIONAL_SLOTS.map(promotionIdOf));
    const fortnightlyRegionals = definitions.filter(
      (definition) =>
        regionalIds.has(definition.promotionId) &&
        definition.recurrence.kind === 'everyNWeeks' &&
        definition.recurrence.intervalWeeks === 2,
    );
    expect(fortnightlyRegionals.length).toBeGreaterThanOrEqual(1);
  });

  it('only signs deals with networks that cover the promotion’s home region', () => {
    const { world } = loadedWorld();
    const deals = world.tables.deals.values();
    expect(deals.length).toBeGreaterThan(0);
    for (const deal of deals) {
      const promotion = world.tables.promotions.get(deal.promotionId);
      const network = world.tables.networks.get(deal.networkId);
      if (promotion === undefined || network === undefined) {
        throw new Error(`Deal ${deal.id} points at a missing promotion or network`);
      }
      expect(coveredRegionIds(network, world), `${promotion.name} on ${network.name}`).toContain(
        promotion.homeRegionId,
      );
    }
  });

  it('keeps the size tiers apart by popularity across the home country', () => {
    const { world } = loadedWorld();
    const geography = geographyOf(world);
    const homePopularity = (key: string): number => {
      const promotion = promotionOf(key);
      const values = new Map<RegionId, number>(
        geography.regions.map((region) => [region.id, promotion.regionalPop[region.id] ?? 0]),
      );
      const homeCountry = geography.countryOf(promotion.homeRegionId).id;
      return geography.aggregateByCountry(values).get(homeCountry)?.value ?? 0;
    };
    for (let tier = 0; tier + 1 < TIERS.length; tier += 1) {
      const bigger = (TIERS[tier] ?? []).map(homePopularity);
      const smaller = (TIERS[tier + 1] ?? []).map(homePopularity);
      expect(Math.min(...bigger), `tier ${String(tier)}`).toBeGreaterThan(Math.max(...smaller));
    }
  });
});
