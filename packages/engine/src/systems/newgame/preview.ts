/**
 * `previewWorld`: what a set of packs holds, for the new-game wizard.
 *
 * The packs are loaded with a fixed preview seed and summarised: the promotions to choose from,
 * the best-known wrestlers, the map for the founding form, every registered setting, the season
 * length choices, the founding numbers per size and the names already taken. The content part is
 * memoised per pack set (ids and versions), because the wizard asks again whenever it re-renders;
 * the settings, season and founding parts are read fresh each time, so a setting registered later
 * shows up.
 *
 * The result is plain JSON, so it crosses the Web Worker boundary as it is.
 *
 * See docs/design/new-game.md#world-preview.
 */

import { assertSerialisable } from '../../core/api/serialisable';
import { ageInYears, type GameDate } from '../../core/date';
import type { PersonId, PromotionId, RegionId } from '../../core/ids';
import type { Employment } from '../../model/entities/employment';
import type { Person } from '../../model/entities/person';
import type { PromotionStyle } from '../../model/entities/promotion-style';
import type { GameWorld } from '../../model/tables';
import type { RawPack } from '../../persistence/packs/index';
import type { PackIssue, Result } from '../../persistence/packs/issues';
import { packManifestSchema, type PackManifest } from '../../persistence/packs/manifest';
import { materialiseWorld } from '../../persistence/packs/materialise';
import { geographyOf, type Geography } from '../world/geography';
import { createEngineTunables } from '../tunables';
import { contentKeysById } from './contentKeys';
import { mergePacks } from './createNewGame';
import { foundingValues, type FoundingValues } from './foundPromotion';
import type { FoundingSize } from './input';
import {
  CUSTOM_SEASON_WEEKS_MAX,
  CUSTOM_SEASON_WEEKS_MIN,
  DEFAULT_SEASON_PRESET,
  SEASON_PRESETS,
  type SeasonPreset,
  type SeasonPresetKey,
} from './season';
import { newGameSettings, type NewGameSettingDef } from './settings';

/** The seed every preview loads with, so the preview of a pack set never changes. */
export const PREVIEW_SEED = 'world-preview';

/** How many wrestlers `topWorkers` lists. */
export const PREVIEW_TOP_WORKERS = 20;

/** How many pack sets the preview memo keeps. */
const PREVIEW_MEMO_SIZE = 4;

/** A place, by pack key and name. */
export interface PlaceRef {
  key: string;
  name: string;
}

export interface PreviewPromotion {
  key: string;
  name: string;
  shortName: string;
  color: string;
  homeRegion: PlaceRef;
  homeCountry: PlaceRef;
  style: PromotionStyle;
  /** In cents. */
  cash: number;
  prestige: number;
  /** Wrestlers under an active contract. */
  rosterSize: number;
  /** Active titles. */
  titleCount: number;
  /** Population-weighted popularity across the home country, one decimal. */
  homeCountryPopularity: number;
  /** Regions where it has any popularity. */
  regionsKnownIn: number;
  /** Active brands, flagship first. */
  brands: PlaceRef[];
}

export interface PopularitySummary {
  /** The country where they are best known, or null for someone unknown everywhere. */
  bestCountry: PlaceRef | null;
  /** Population-weighted popularity across that country, one decimal. */
  bestCountryPopularity: number;
  /** Regions where they have any popularity. */
  regionsKnownIn: number;
}

export interface PreviewWorker {
  key: string;
  ringName: string;
  /** The short name of the promotion they work for, or null for a free agent. */
  promotionShortName: string | null;
  age: number;
  style: Person['style'];
  popularitySummary: PopularitySummary;
}

export interface PreviewRegion {
  key: string;
  name: string;
  population: number;
}

export interface PreviewCountry {
  key: string;
  name: string;
  regions: PreviewRegion[];
}

export interface PreviewContinent {
  key: string;
  name: string;
  countries: PreviewCountry[];
}

export interface WorldPreview {
  manifest: PackManifest;
  startDate: GameDate;
  /** Every active promotion, most prestigious first. */
  promotions: PreviewPromotion[];
  /** The best-known active wrestlers, best known first. */
  topWorkers: PreviewWorker[];
  /** How many active people (wrestlers and staff, employed or not) the world starts with. */
  peopleCount: number;
  /** Continents, their countries and their regions, most populous first. */
  regions: PreviewContinent[];
  /** Every registered new-game setting. */
  settings: NewGameSettingDef[];
  seasonLength: {
    presets: SeasonPreset[];
    defaultPreset: SeasonPresetKey;
    customWeeks: { min: number; max: number };
  };
  /** The founding numbers per size, from the tunables at their defaults. Cash is in cents. */
  foundingSizes: Record<FoundingSize, FoundingValues>;
  /** Every promotion's short name, sorted; a founded promotion must pick another. */
  takenShortNames: string[];
  /** Every promotion's name, sorted; a founded promotion must pick another. */
  takenNames: string[];
}

/** The memoised, content-derived part of a preview. */
type ContentPreview = Pick<
  WorldPreview,
  | 'manifest'
  | 'startDate'
  | 'promotions'
  | 'topWorkers'
  | 'peopleCount'
  | 'regions'
  | 'takenShortNames'
  | 'takenNames'
>;

/** A memoised content preview and the (warning) issues the packs loaded with. */
interface MemoEntry {
  readonly content: Readonly<ContentPreview>;
  readonly issues: readonly PackIssue[];
}

const memo = new Map<string, MemoEntry>();

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    const children: unknown[] = Object.values(value);
    for (const child of children) {
      deepFreeze(child);
    }
  }
  return value;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function memoKey(packs: readonly RawPack[], rootPackId: string): string {
  const versions = packs
    .map((pack) => `${pack.manifest.id}@${pack.manifest.version}`)
    .sort(compareText);
  return `${rootPackId}|${versions.join(',')}`;
}

/** Population-weighted popularity per country from a sparse regional record. */
function countryPopularity(
  geography: Geography,
  regionalPop: Readonly<Record<RegionId, number>>,
): Map<string, number> {
  const totals = new Map<string, { weighted: number; population: number }>();
  for (const country of geography.countries) {
    let weighted = 0;
    let population = 0;
    for (const region of geography.regionsOf(country.id)) {
      weighted += (regionalPop[region.id] ?? 0) * region.population;
      population += region.population;
    }
    totals.set(country.id, { weighted, population });
  }
  const result = new Map<string, number>();
  for (const [countryId, total] of totals) {
    result.set(countryId, total.population > 0 ? total.weighted / total.population : 0);
  }
  return result;
}

interface Places {
  readonly geography: Geography;
  readonly regionKeys: ReadonlyMap<string, string>;
  readonly countryKeys: ReadonlyMap<string, string>;
  readonly continentKeys: ReadonlyMap<string, string>;
}

function placeRef(keys: ReadonlyMap<string, string>, id: string, name: string): PlaceRef {
  return { key: keys.get(id) ?? id, name };
}

function previewPromotions(world: GameWorld, places: Places): PreviewPromotion[] {
  const promotionKeys = contentKeysById(world.meta, 'promotion');
  const brandKeys = contentKeysById(world.meta, 'brand');
  const { geography } = places;
  const active = world.tables.promotions.values().filter((row) => row.status === 'active');
  const rows = active.map((promotion) => {
    const region = geography.region(promotion.homeRegionId);
    const country = geography.countryOf(promotion.homeRegionId);
    const rosterSize = world.tables.employments
      .lookup('byPromotionStatus', `${promotion.id}|active`)
      .filter((employment) => employment.role === 'wrestler').length;
    const titleCount = world.tables.titles
      .values()
      .filter((title) => title.promotionId === promotion.id && title.status === 'active').length;
    const brands = world.tables.brands
      .lookup('byPromotion', promotion.id)
      .filter((brand) => brand.active)
      .sort((left, right) => left.priority - right.priority || compareText(left.id, right.id))
      .map((brand) => placeRef(brandKeys, brand.id, brand.name));
    return {
      key: promotionKeys.get(promotion.id) ?? promotion.id,
      name: promotion.name,
      shortName: promotion.shortName,
      color: promotion.color,
      homeRegion: placeRef(places.regionKeys, region.id, region.name),
      homeCountry: placeRef(places.countryKeys, country.id, country.name),
      style: promotion.style,
      cash: promotion.cash,
      prestige: promotion.prestige,
      rosterSize,
      titleCount,
      homeCountryPopularity: oneDecimal(
        countryPopularity(geography, promotion.regionalPop).get(country.id) ?? 0,
      ),
      regionsKnownIn: Object.keys(promotion.regionalPop).length,
      brands,
    };
  });
  return rows.sort(
    (left, right) => right.prestige - left.prestige || compareText(left.name, right.name),
  );
}

function previewWorkers(world: GameWorld, places: Places): PreviewWorker[] {
  const personKeys = contentKeysById(world.meta, 'person');
  const { geography } = places;
  const contractOf = new Map<PersonId, Employment>();
  for (const employment of world.tables.employments.values()) {
    if (employment.status === 'active' && !contractOf.has(employment.personId)) {
      contractOf.set(employment.personId, employment);
    }
  }
  const shortNameOf = new Map<PromotionId, string>(
    world.tables.promotions.values().map((promotion) => [promotion.id, promotion.shortName]),
  );
  const ranked = world.tables.people
    .values()
    .filter((person) => person.status === 'active' && person.roles.includes('wrestler'))
    .map((person) => {
      let bestCountryId: string | null = null;
      let best = 0;
      for (const [countryId, value] of countryPopularity(geography, person.regionalPop)) {
        if (value > best) {
          best = value;
          bestCountryId = countryId;
        }
      }
      return { person, bestCountryId, best };
    })
    .sort((left, right) => right.best - left.best || compareText(left.person.id, right.person.id))
    .slice(0, PREVIEW_TOP_WORKERS);

  return ranked.map(({ person, bestCountryId, best }) => {
    const contract = contractOf.get(person.id);
    const country =
      bestCountryId === null ? null : geography.countries.find((row) => row.id === bestCountryId);
    return {
      key: personKeys.get(person.id) ?? person.id,
      ringName: contract?.ringName ?? person.defaultRingName,
      promotionShortName:
        contract === undefined ? null : (shortNameOf.get(contract.promotionId) ?? null),
      age: ageInYears(person.birthDate, world.meta.startDate),
      style: person.style,
      popularitySummary: {
        bestCountry:
          country === undefined || country === null
            ? null
            : placeRef(places.countryKeys, country.id, country.name),
        bestCountryPopularity: oneDecimal(best),
        regionsKnownIn: Object.keys(person.regionalPop).length,
      },
    };
  });
}

function previewRegions(places: Places): PreviewContinent[] {
  const { geography } = places;
  return [...geography.continents]
    .sort((left, right) => compareText(left.name, right.name))
    .map((continent) => ({
      key: places.continentKeys.get(continent.id) ?? continent.id,
      name: continent.name,
      countries: geography.countriesOf(continent.id).map((country) => ({
        key: places.countryKeys.get(country.id) ?? country.id,
        name: country.name,
        regions: geography.regionsOf(country.id).map((region) => ({
          key: places.regionKeys.get(region.id) ?? region.id,
          name: region.name,
          population: region.population,
        })),
      })),
    }));
}

function contentPreview(
  packs: readonly RawPack[],
  rootPackId: string,
): Result<Readonly<ContentPreview>> {
  const merged = mergePacks(packs, rootPackId);
  if (!merged.ok) {
    return { ok: false, issues: merged.issues };
  }
  const { content } = merged;
  const root = packs.find((pack) => pack.manifest.id === rootPackId);
  if (root === undefined || content.startDate === null) {
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          code: 'missing-start-date',
          packId: rootPackId,
          path: ['startDate'],
          message: `Pack "${rootPackId}" is not a world pack, so it has no start date`,
        },
      ],
    };
  }
  const materialised = materialiseWorld(content, {
    seed: PREVIEW_SEED,
    startDate: content.startDate,
  });
  if (!materialised.ok) {
    return { ok: false, issues: materialised.issues };
  }
  const { world } = materialised.value;
  const places: Places = {
    geography: geographyOf(world),
    regionKeys: contentKeysById(world.meta, 'region'),
    countryKeys: contentKeysById(world.meta, 'country'),
    continentKeys: contentKeysById(world.meta, 'continent'),
  };
  const allPromotions = world.tables.promotions.values();
  const preview: ContentPreview = {
    // A fresh copy (parsing builds new objects): the memo freezes the preview, and the caller's
    // pack must stay as it was.
    manifest: packManifestSchema.parse(root.manifest),
    startDate: content.startDate,
    promotions: previewPromotions(world, places),
    topWorkers: previewWorkers(world, places),
    peopleCount: world.tables.people.values().filter((person) => person.status === 'active').length,
    regions: previewRegions(places),
    takenShortNames: allPromotions.map((promotion) => promotion.shortName).sort(compareText),
    takenNames: allPromotions.map((promotion) => promotion.name).sort(compareText),
  };
  return { ok: true, value: deepFreeze(preview), issues: materialised.issues };
}

/**
 * Summarises the world the packs would start: see {@link WorldPreview}. Returns the pack issues
 * when the packs do not load. Never throws for bad packs.
 */
export function previewWorld(packs: readonly RawPack[], rootPackId: string): Result<WorldPreview> {
  const key = memoKey(packs, rootPackId);
  let entry = memo.get(key);
  if (entry === undefined) {
    const built = contentPreview(packs, rootPackId);
    if (!built.ok) {
      return built;
    }
    entry = { content: built.value, issues: built.issues };
    memo.set(key, entry);
    while (memo.size > PREVIEW_MEMO_SIZE) {
      const oldest = memo.keys().next();
      if (oldest.done === true) {
        break;
      }
      memo.delete(oldest.value);
    }
  }
  const tunables = createEngineTunables();
  const foundingSizes: Record<FoundingSize, FoundingValues> = {
    small: foundingValues(tunables, 'small'),
    medium: foundingValues(tunables, 'medium'),
    large: foundingValues(tunables, 'large'),
  };
  const preview: WorldPreview = {
    ...entry.content,
    settings: newGameSettings(),
    seasonLength: {
      presets: SEASON_PRESETS.map((preset) => ({ ...preset })),
      defaultPreset: DEFAULT_SEASON_PRESET,
      customWeeks: { min: CUSTOM_SEASON_WEEKS_MIN, max: CUSTOM_SEASON_WEEKS_MAX },
    },
    foundingSizes,
  };
  assertSerialisable(preview, 'previewWorld');
  return { ok: true, value: preview, issues: entry.issues };
}
