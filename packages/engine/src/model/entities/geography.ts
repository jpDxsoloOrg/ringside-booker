/**
 * The location hierarchy: continent → country → region.
 *
 * Every popularity and reach calculation keys on these (design decision D-03). Regions are the unit
 * that popularity is stored per; countries and continents are population-weighted roll-ups for
 * display and coarse checks. Every location field anywhere in the engine is a `ContinentId`,
 * `CountryId` or `RegionId`, never a name, so there is one location model in the whole game.
 *
 * The actual geography (names, populations, interest) is world content, not code.
 */

import { z } from 'zod';
import type { RegionId } from '../../core/ids';
import type { IntegrityIssue } from '../integrity';
import { zId, zNonNegativeInt, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf } from '../world';
import { zUniqueIdList } from './id-list';
import { PromotionStyleSchema } from './promotion-style';

/** A continent or country code: two or three uppercase letters, such as `EU` or `NZL`. */
export const LOCATION_CODE_PATTERN = /^[A-Z]{2,3}$/;

const zLocationCode = z
  .string()
  .regex(LOCATION_CODE_PATTERN, 'Expected a code of two or three uppercase letters');

export const ContinentSchema = z.strictObject({
  id: zId('continent'),
  name: z.string().min(1).max(40),
  /** Unique across continents. */
  code: zLocationCode,
});

export type Continent = z.infer<typeof ContinentSchema>;

export const CountrySchema = z.strictObject({
  id: zId('country'),
  continentId: zId('continent'),
  name: z.string().min(1).max(60),
  /** Unique across countries. */
  code: zLocationCode,
  /** Number of people. */
  population: zNonNegativeInt,
  /** How much the population cares about wrestling, 0-100. */
  wrestlingInterest: zStat,
  /** How much money there is to spend, 0-100. */
  economy: zStat,
  /** The style audiences here like best, or null for no preference. */
  preferredStyle: PromotionStyleSchema.nullable(),
});

export type Country = z.infer<typeof CountrySchema>;

export const RegionSchema = z
  .strictObject({
    id: zId('region'),
    countryId: zId('country'),
    name: z.string().min(1).max(60),
    /** Number of people. */
    population: zNonNegativeInt,
    /** How much the population cares about wrestling, 0-100. */
    wrestlingInterest: zStat,
    /** The style audiences here like best, or null for no preference. */
    preferredStyle: PromotionStyleSchema.nullable(),
    /**
     * Regions that border this one, for touring and popularity spread. Adjacency is symmetric:
     * when A lists B, B lists A (a `checkWorld` invariant).
     */
    neighbourRegionIds: zUniqueIdList('region'),
  })
  .superRefine((region, context) => {
    region.neighbourRegionIds.forEach((neighbourId, index) => {
      if (neighbourId === region.id) {
        context.addIssue({
          code: 'custom',
          message: 'A region cannot be its own neighbour',
          path: ['neighbourRegionIds', index],
        });
      }
    });
  });

export type Region = z.infer<typeof RegionSchema>;

export const continentsTable = defineTable({
  kind: 'continent',
  name: 'continents',
  schema: ContinentSchema,
  refs: [],
  indexes: [{ name: 'byCode', key: (continent) => continent.code, unique: true }],
});

export const countriesTable = defineTable({
  kind: 'country',
  name: 'countries',
  schema: CountrySchema,
  refs: [{ path: 'continentId', target: 'continent', nullable: false }],
  indexes: [
    { name: 'byContinent', key: (country) => country.continentId },
    { name: 'byCode', key: (country) => country.code, unique: true },
  ],
});

/** Every pair where one region lists another as a neighbour but is not listed back. */
function asymmetricNeighbourIssues(regions: readonly Region[]): IntegrityIssue[] {
  const neighboursById = new Map<RegionId, ReadonlySet<RegionId>>(
    regions.map((region) => [region.id, new Set(region.neighbourRegionIds)]),
  );
  const issues: IntegrityIssue[] = [];
  for (const region of regions) {
    region.neighbourRegionIds.forEach((neighbourId, index) => {
      const listedBack = neighboursById.get(neighbourId);
      // A neighbour that does not exist is a dangling reference, reported by the reference check.
      if (listedBack === undefined || listedBack.has(region.id)) {
        return;
      }
      issues.push({
        code: 'region.neighbourNotMutual',
        table: 'regions',
        id: region.id,
        path: `neighbourRegionIds[${String(index)}]`,
        message: `Region ${region.id} lists ${neighbourId} as a neighbour, but ${neighbourId} does not list it back`,
      });
    });
  }
  return issues;
}

export const regionsTable = defineTable({
  kind: 'region',
  name: 'regions',
  schema: RegionSchema,
  refs: [
    { path: 'countryId', target: 'country', nullable: false },
    { path: 'neighbourRegionIds[]', target: 'region', nullable: false },
  ],
  indexes: [{ name: 'byCountry', key: (region) => region.countryId }],
  invariants: [
    {
      name: 'neighboursAreMutual',
      check(view): IntegrityIssue[] {
        return asymmetricNeighbourIssues(tableOf(view, regionsTable).values());
      },
    },
  ],
});
