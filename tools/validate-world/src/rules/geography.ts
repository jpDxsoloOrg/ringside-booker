/**
 * `geography`: the map adds up.
 *
 * - Every country has at least one region (error).
 * - A country's regions add up to its population, give or take 5% (error).
 * - Every country has a name mix (`countryNameMix`), so people born there get names (error).
 */

import type { ValidationIssue } from '../issues';
import { recordIssue, refKey, sortedRecords, type ContentRule } from './helpers';

/** How far the regions' total population may be from the country's, as a share of the country's. */
export const POPULATION_TOLERANCE = 0.05;

export const geography: ContentRule = {
  id: 'geography',
  description:
    "Every country has regions whose populations add up to the country's (within 5%) and a name mix",
  check(_world, content) {
    const regionsByCountry = new Map<string, { count: number; population: number }>();
    for (const [, merged] of sortedRecords(content, 'region')) {
      const countryKey = refKey(merged.record.countryKey);
      const totals = regionsByCountry.get(countryKey) ?? { count: 0, population: 0 };
      regionsByCountry.set(countryKey, {
        count: totals.count + 1,
        population: totals.population + merged.record.population,
      });
    }
    const countriesWithMix = new Set(
      [...content.records.countryNameMix.values()].map((merged) =>
        refKey(merged.record.countryKey),
      ),
    );

    const issues: ValidationIssue[] = [];
    for (const [key, merged] of sortedRecords(content, 'country')) {
      const country = merged.record;
      const regions = regionsByCountry.get(key);
      if (regions === undefined) {
        issues.push(
          recordIssue(
            'error',
            'geography',
            'country',
            key,
            merged,
            [],
            `Country ${key} has no regions`,
          ),
        );
      } else {
        const allowed = country.population * POPULATION_TOLERANCE;
        if (Math.abs(regions.population - country.population) > allowed) {
          issues.push(
            recordIssue(
              'error',
              'geography',
              'country',
              key,
              merged,
              ['population'],
              `The regions of ${key} (${String(regions.count)}) add up to ${String(regions.population)} people, but the country has ${String(country.population)}, more than ${String(POPULATION_TOLERANCE * 100)}% apart`,
            ),
          );
        }
      }
      if (!countriesWithMix.has(key)) {
        issues.push(
          recordIssue(
            'error',
            'geography',
            'country',
            key,
            merged,
            [],
            `Country ${key} has no countryNameMix record, so people born there cannot be named`,
          ),
        );
      }
    }
    return issues;
  },
};
