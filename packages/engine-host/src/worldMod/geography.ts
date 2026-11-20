/**
 * Geography: the mod's countries and regions placed on the base pack's map.
 *
 * - A mod country whose name matches a base country (or a known alias) is that base country.
 * - When the mod defines regions inside a matched country, a region whose name matches a base
 *   region is that region; the others are added as new regions of the base country, and the base
 *   regions they replace are patched to population 0 so the country is not counted twice. When the
 *   mod has no regions there, references go to the base country's most populous region.
 * - Any other country is added with all its mod regions (or one region covering the whole country
 *   when the mod has none).
 *
 * Only countries some imported record refers to are added, so a mod listing every country on Earth
 * does not flood the world with empty markets. Records ask for region keys while they convert
 * (`resolvePlace`), which marks countries as used; `finish` then emits the records.
 */

import type { ModRow, ModTables } from './rows';
import { clamp, cut, id, int, tableRows, text } from './rows';
import { CONTINENTS, COUNTRY_ALIASES, lookup, normaliseName, PROMOTION_STYLES } from './mapping';
import type { ReportBuilder } from './report';

export interface BaseContinent {
  readonly key: string;
  readonly name: string;
}
export interface BaseCountry {
  readonly key: string;
  readonly name: string;
  readonly code: string;
  readonly continentKey: string;
}
export interface BaseRegion {
  readonly key: string;
  readonly name: string;
  readonly countryKey: string;
  readonly population: number;
}

/** The base pack's map, as the converter needs it. */
export interface BaseGeography {
  readonly continents: readonly BaseContinent[];
  readonly countries: readonly BaseCountry[];
  readonly regions: readonly BaseRegion[];
}

interface ModCountry {
  readonly id: number;
  readonly name: string;
  readonly continentKey: string;
  readonly row: ModRow;
  /** The matched base country, or null for a country the pack adds. */
  readonly baseKey: string | null;
  readonly regions: ModRegion[];
}

interface ModRegion {
  readonly id: number;
  readonly name: string;
  readonly row: ModRow;
  /** Set once the country is used. */
  key: string | null;
}

/**
 * A record's place as the mod stores it. The mods are not consistent: venues and the map tables use
 * numeric ids, while promotions, people and shows store the country and region *names* as text
 * (and empty text for "none"). Each column is read as an id when it holds a number and as a name
 * otherwise.
 */
export type PlaceRef = number | string | null;

/** How a record's region was found, for the report. */
export type PlaceSource = 'region' | 'country' | 'continent' | 'none';

export interface ResolvedPlace {
  readonly key: string | null;
  readonly source: PlaceSource;
  /** True when the record named a region or country that the mod's map does not have. */
  readonly unmatched: boolean;
}

/** A location column as an id (a positive number, or numeric text) or a name (other text). */
export function placeRef(row: ModRow, column: string): PlaceRef {
  const numeric = id(row, column);
  if (numeric !== null) return numeric;
  const name = text(row, column);
  if (name === null || /^[-0-9.]+$/.test(name)) return null;
  return name;
}

/** A region of the finished map, for spreading continent popularity. */
export interface MapRegion {
  readonly key: string;
  readonly continentKey: string;
  readonly population: number;
}

export interface GeographyRecords {
  readonly countries: Record<string, unknown>[];
  readonly regions: Record<string, unknown>[];
}

function regionPopulation(row: ModRow): number {
  return Math.max(0, int(row, 'population') ?? 0);
}

export class Geography {
  private readonly countries = new Map<number, ModCountry>();
  private readonly regionsById = new Map<number, { region: ModRegion; country: ModCountry }>();
  private readonly countriesByName = new Map<string, ModCountry>();
  /** Regions by name across every country; null when two countries share the name. */
  private readonly regionsByName = new Map<
    string,
    { region: ModRegion; country: ModCountry } | null
  >();
  private readonly used = new Set<number>();
  private readonly baseRegionsByCountry = new Map<string, BaseRegion[]>();
  private readonly continentKeys = new Set<string>();
  private readonly fallbackRegionByContinent = new Map<string, string>();
  private readonly usedCodes = new Set<string>();
  private readonly codes = new Map<number, string>();
  private readonly zeroedBaseRegions = new Set<string>();

  constructor(
    private readonly base: BaseGeography,
    tables: ModTables,
    private readonly report: ReportBuilder,
  ) {
    for (const continent of base.continents) this.continentKeys.add(continent.key);
    for (const country of base.countries) this.usedCodes.add(country.code);
    for (const region of base.regions) {
      const list = this.baseRegionsByCountry.get(region.countryKey) ?? [];
      list.push(region);
      this.baseRegionsByCountry.set(region.countryKey, list);
    }
    const baseByName = new Map<string, BaseCountry>();
    for (const country of base.countries) baseByName.set(normaliseName(country.name), country);
    const countryContinent = new Map(base.countries.map((country) => [country.key, country]));
    for (const region of [...base.regions].sort(
      (left, right) => right.population - left.population,
    )) {
      const continentKey = countryContinent.get(region.countryKey)?.continentKey;
      if (continentKey !== undefined && !this.fallbackRegionByContinent.has(continentKey)) {
        this.fallbackRegionByContinent.set(continentKey, region.key);
      }
    }

    for (const row of tableRows(tables, 'countries')) {
      const countryId = id(row, 'countryID');
      const name = text(row, 'countryName');
      if (countryId === null || name === null) continue;
      const continentName = text(row, 'continent') ?? '';
      let continentKey = lookup(CONTINENTS, continentName);
      if (continentKey === undefined || !this.continentKeys.has(continentKey)) {
        report.warn(
          'unknown-continent',
          'A country names a continent the game does not know; it was placed in North America',
          `countries#${String(countryId)}`,
        );
        continentKey = 'na';
      }
      const normalised = normaliseName(name);
      const matched = baseByName.get(COUNTRY_ALIASES[normalised] ?? normalised) ?? null;
      this.countries.set(countryId, {
        id: countryId,
        name,
        continentKey: matched?.continentKey ?? continentKey,
        row,
        baseKey: matched?.key ?? null,
        regions: [],
      });
    }
    for (const row of tableRows(tables, 'regions')) {
      const regionId = id(row, 'regionID');
      const name = text(row, 'regionName');
      const parent = id(row, 'regionParent');
      if (regionId === null || name === null) continue;
      const country = parent === null ? undefined : this.countries.get(parent);
      if (country === undefined) {
        report.warn(
          'orphan-region',
          'A region belongs to no known country and was left out',
          `regions#${String(regionId)}`,
        );
        continue;
      }
      const region: ModRegion = { id: regionId, name, row, key: null };
      country.regions.push(region);
      this.regionsById.set(regionId, { region, country });
      const regionName = normaliseName(name);
      this.regionsByName.set(
        regionName,
        this.regionsByName.has(regionName) ? null : { region, country },
      );
    }
    for (const country of [...this.countries.values()].sort((left, right) => left.id - right.id)) {
      const countryName = normaliseName(country.name);
      if (!this.countriesByName.has(countryName)) this.countriesByName.set(countryName, country);
    }
  }

  /** The mod country a reference points at: by id, by name, or by a known alias of the name. */
  private countryOf(ref: PlaceRef): ModCountry | undefined {
    if (ref === null) return undefined;
    if (typeof ref === 'number') return this.countries.get(ref);
    const name = normaliseName(ref);
    const direct = this.countriesByName.get(name);
    if (direct !== undefined) return direct;
    const alias = COUNTRY_ALIASES[name];
    if (alias === undefined) return undefined;
    for (const country of this.countriesByName.values()) {
      const countryName = normaliseName(country.name);
      if ((COUNTRY_ALIASES[countryName] ?? countryName) === alias) return country;
    }
    return undefined;
  }

  /** The mod region a reference points at; a name is looked up in `country` when one is known. */
  private regionOf(
    ref: PlaceRef,
    country: ModCountry | undefined,
  ): { region: ModRegion; country: ModCountry } | undefined {
    if (ref === null) return undefined;
    if (typeof ref === 'number') return this.regionsById.get(ref);
    const name = normaliseName(ref);
    if (country !== undefined) {
      const inCountry = country.regions.find((region) => normaliseName(region.name) === name);
      return inCountry === undefined ? undefined : { region: inCountry, country };
    }
    return this.regionsByName.get(name) ?? undefined;
  }

  /** Marks a country as used and gives its regions their keys. */
  private use(country: ModCountry): void {
    if (this.used.has(country.id)) return;
    this.used.add(country.id);
    if (country.baseKey !== null) {
      const baseRegions = this.baseRegionsByCountry.get(country.baseKey) ?? [];
      const baseByName = new Map(baseRegions.map((region) => [normaliseName(region.name), region]));
      let added = false;
      for (const region of country.regions) {
        const matched = baseByName.get(normaliseName(region.name));
        if (matched !== undefined) {
          region.key = matched.key;
          baseByName.delete(normaliseName(region.name));
        } else {
          region.key = `wm-r${String(region.id)}`;
          added = true;
        }
      }
      if (added) for (const left of baseByName.values()) this.zeroedBaseRegions.add(left.key);
    } else {
      for (const region of country.regions) region.key = `wm-r${String(region.id)}`;
    }
  }

  private countryKeyOf(country: ModCountry): string {
    return country.baseKey ?? `wm-c${String(country.id)}`;
  }

  /** The main region of a used country: its most populous one. */
  private mainRegion(country: ModCountry): string {
    this.use(country);
    if (country.regions.length > 0) {
      const biggest = [...country.regions].sort(
        (left, right) =>
          regionPopulation(right.row) - regionPopulation(left.row) || left.id - right.id,
      )[0];
      if (biggest?.key !== null && biggest?.key !== undefined) return biggest.key;
    }
    if (country.baseKey !== null) {
      const baseRegions = [...(this.baseRegionsByCountry.get(country.baseKey) ?? [])].sort(
        (left, right) => right.population - left.population,
      );
      const first = baseRegions[0];
      if (first !== undefined) return first.key;
    }
    return `wm-c${String(country.id)}-all`;
  }

  /** The base continent key for a mod continent name, or null. */
  continentKey(name: string | null): string | null {
    if (name === null) return null;
    const key = lookup(CONTINENTS, name);
    return key !== undefined && this.continentKeys.has(key) ? key : null;
  }

  /**
   * The region key for a record's location (ids or names, see `PlaceRef`): its region, else its
   * country's main region, else the most populous base region of its continent. `source` says
   * which one answered, so the caller can report continent fallbacks.
   */
  resolvePlace(
    regionRef: PlaceRef,
    countryRef: PlaceRef,
    continentName: string | null,
  ): ResolvedPlace {
    const country = this.countryOf(countryRef);
    const region = this.regionOf(regionRef, country);
    const unmatched =
      (countryRef !== null && country === undefined) ||
      (regionRef !== null && region === undefined && country === undefined);
    if (region !== undefined) {
      this.use(region.country);
      if (region.region.key !== null) {
        return { key: region.region.key, source: 'region', unmatched: false };
      }
    }
    if (country !== undefined) {
      return { key: this.mainRegion(country), source: 'country', unmatched: false };
    }
    const continentKey = this.continentKey(continentName);
    if (continentKey !== null) {
      const key = this.fallbackRegionByContinent.get(continentKey) ?? null;
      if (key !== null) return { key, source: 'continent', unmatched };
    }
    return { key: null, source: 'none', unmatched };
  }

  /** The country key for a network's coverage, or null when that country is not in the world. */
  coverageCountry(countryId: number): string | null {
    const country = this.countries.get(countryId);
    if (country === undefined) return null;
    if (country.baseKey !== null) return country.baseKey;
    return this.used.has(country.id) ? this.countryKeyOf(country) : null;
  }

  /** The region key for a network's coverage, or null when that region is not in the world. */
  coverageRegion(regionId: number): string | null {
    const found = this.regionsById.get(regionId);
    if (found === undefined || !this.used.has(found.country.id)) return null;
    return found.region.key;
  }

  /** The base region every other fallback ends at: the most populous one in the world. */
  worldFallbackRegion(): string {
    const biggest = [...this.base.regions].sort(
      (left, right) => right.population - left.population,
    )[0];
    return biggest?.key ?? 'us-northeast';
  }

  private countryCode(country: ModCountry): string {
    const known = this.codes.get(country.id);
    if (known !== undefined) return known;
    const letters = normaliseName(country.name).replace(/[0-9]/g, '').toUpperCase();
    const candidates: string[] = [];
    if (letters.length >= 2) {
      for (let second = 1; second < letters.length; second += 1) {
        candidates.push(`${letters.charAt(0)}${letters.charAt(second)}`);
      }
      for (let third = 2; third < letters.length; third += 1) {
        candidates.push(`${letters.charAt(0)}${letters.charAt(1)}${letters.charAt(third)}`);
      }
    }
    let code = candidates.find((candidate) => !this.usedCodes.has(candidate));
    for (let index = 0; code === undefined; index += 1) {
      const candidate = `X${String.fromCharCode(65 + (Math.floor(index / 26) % 26))}${String.fromCharCode(65 + (index % 26))}`;
      if (!this.usedCodes.has(candidate)) code = candidate;
    }
    this.usedCodes.add(code);
    this.codes.set(country.id, code);
    return code;
  }

  /** The countries and regions the pack adds or changes, once every record has been converted. */
  finish(): GeographyRecords {
    const countries: Record<string, unknown>[] = [];
    const regions: Record<string, unknown>[] = [];
    const usedCountries = [...this.countries.values()]
      .filter((country) => this.used.has(country.id))
      .sort((left, right) => left.id - right.id);
    for (const country of usedCountries) {
      const countryKey = this.countryKeyOf(country);
      const style = lookup(PROMOTION_STYLES, text(country.row, 'preferredStyle') ?? '') ?? null;
      if (country.baseKey === null) {
        const population = Math.max(0, int(country.row, 'population') ?? 0);
        countries.push({
          key: countryKey,
          name: cut(country.name, 60),
          code: this.countryCode(country),
          continentKey: country.continentKey,
          population,
          wrestlingInterest: clamp(int(country.row, 'wrestlingPopularity') ?? 50, 0, 100),
          // The mods rate economies 0-100 with the richest at 100; the engine's reference is 50.
          economy: clamp(Math.round((int(country.row, 'economy') ?? 60) * 0.75), 0, 100),
          preferredStyle: style,
        });
        if (country.regions.length === 0) {
          regions.push({
            key: `${countryKey}-all`,
            name: cut(country.name, 60),
            countryKey,
            population,
            neighbourKeys: [],
          });
        }
      }
      for (const region of country.regions) {
        if (!region.key?.startsWith('wm-')) continue;
        const regionStyle = lookup(PROMOTION_STYLES, text(region.row, 'preferredStyle') ?? '');
        const interest = int(region.row, 'wrestlingPopularity');
        regions.push({
          key: region.key,
          name: cut(region.name, 60),
          countryKey,
          population: regionPopulation(region.row),
          ...(interest === null ? {} : { wrestlingInterest: clamp(interest, 0, 100) }),
          ...(regionStyle === undefined ? {} : { preferredStyle: regionStyle }),
          neighbourKeys: [],
        });
      }
    }
    for (const key of [...this.zeroedBaseRegions].sort()) {
      regions.push({ key, $override: 'patch', population: 0 });
    }
    return { countries, regions };
  }

  /**
   * Every populated region of the used countries, for spreading continent popularity. Call after
   * `finish`.
   */
  mapRegions(): MapRegion[] {
    const out: MapRegion[] = [];
    const usedCountries = [...this.countries.values()]
      .filter((country) => this.used.has(country.id))
      .sort((left, right) => left.id - right.id);
    const seen = new Set<string>();
    for (const country of usedCountries) {
      const add = (key: string, population: number): void => {
        if (population <= 0 || seen.has(key)) return;
        seen.add(key);
        out.push({ key, continentKey: country.continentKey, population });
      };
      if (country.baseKey !== null) {
        for (const region of this.baseRegionsByCountry.get(country.baseKey) ?? []) {
          if (!this.zeroedBaseRegions.has(region.key)) add(region.key, region.population);
        }
        for (const region of country.regions) {
          if (region.key?.startsWith('wm-') === true) {
            add(region.key, regionPopulation(region.row));
          }
        }
      } else if (country.regions.length === 0) {
        add(`wm-c${String(country.id)}-all`, Math.max(1, int(country.row, 'population') ?? 1));
      } else {
        for (const region of country.regions) {
          if (region.key !== null) add(region.key, regionPopulation(region.row));
        }
      }
    }
    return out;
  }
}
