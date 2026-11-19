/**
 * Reads the map a converted world builds on (continents, countries, regions) out of the bundled
 * `base` pack. Records that are not well formed are skipped: the pack loader reports those itself.
 */

import type { RawPack } from '@ringside/engine';
import type { BaseContinent, BaseCountry, BaseGeography, BaseRegion } from './geography';

function records(
  pack: RawPack,
  kind: 'continent' | 'country' | 'region',
): Record<string, unknown>[] {
  const list = pack.files[kind];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
}

function str(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' ? value : null;
}

/** The base pack's map and its version (the converted pack depends on `^<version>`). */
export function baseGeographyOf(base: RawPack): BaseGeography & { readonly baseVersion: string } {
  const continents: BaseContinent[] = [];
  for (const record of records(base, 'continent')) {
    const key = str(record, 'key');
    const name = str(record, 'name');
    if (key !== null && name !== null) continents.push({ key, name });
  }
  const countries: BaseCountry[] = [];
  for (const record of records(base, 'country')) {
    const key = str(record, 'key');
    const name = str(record, 'name');
    const code = str(record, 'code');
    const continentKey = str(record, 'continentKey');
    if (key !== null && name !== null && code !== null && continentKey !== null) {
      countries.push({ key, name, code, continentKey });
    }
  }
  const regions: BaseRegion[] = [];
  for (const record of records(base, 'region')) {
    const key = str(record, 'key');
    const name = str(record, 'name');
    const countryKey = str(record, 'countryKey');
    const population = record['population'];
    if (key !== null && name !== null && countryKey !== null && typeof population === 'number') {
      regions.push({ key, name, countryKey, population });
    }
  }
  return { continents, countries, regions, baseVersion: base.manifest.version };
}
