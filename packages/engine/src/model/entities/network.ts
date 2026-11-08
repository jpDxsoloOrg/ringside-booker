/**
 * Networks: the TV channels, pay-per-view providers and streaming services that air shows.
 *
 * A network's coverage is a set of locations by ID at any level of the hierarchy: whole
 * continents, whole countries and single regions. `coveredRegionIds` expands it to the regions it
 * reaches, which is what reach and popularity calculations work with.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { ContinentId, CountryId, RegionId } from '../../core/ids';
import { zGameDate, zId, zImageRef } from '../primitives';
import { compareIds } from '../table';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { countriesTable, regionsTable } from './geography';
import { zUniqueIdList } from './id-list';

export const NETWORK_KINDS = ['tv', 'ppv', 'streaming'] as const;
export const NetworkKindSchema = z.enum(NETWORK_KINDS);
export type NetworkKind = z.infer<typeof NetworkKindSchema>;

export const NETWORK_STATUSES = ['active', 'closed'] as const;
export const NetworkStatusSchema = z.enum(NETWORK_STATUSES);
export type NetworkStatus = z.infer<typeof NetworkStatusSchema>;

/** The highest reach tier: 0 is a local channel, 4 a global one. */
export const NETWORK_REACH_TIER_MAX = 4;

export const NetworkCoverageSchema = z
  .strictObject({
    continentIds: zUniqueIdList('continent'),
    countryIds: zUniqueIdList('country'),
    regionIds: zUniqueIdList('region'),
  })
  .superRefine((coverage, context) => {
    const total =
      coverage.continentIds.length + coverage.countryIds.length + coverage.regionIds.length;
    if (total === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A network must cover at least one continent, country or region',
      });
    }
  });

export type NetworkCoverage = z.infer<typeof NetworkCoverageSchema>;

export const NetworkSchema = z
  .strictObject({
    id: zId('network'),
    name: z.string().min(1).max(60),
    kind: NetworkKindSchema,
    reachTier: z.number().int().min(0).max(NETWORK_REACH_TIER_MAX),
    coverage: NetworkCoverageSchema,
    /** The promotion that owns the network (its own streaming service), or null. */
    ownerPromotionId: zId('promotion').nullable(),
    status: NetworkStatusSchema,
    launchedOn: zGameDate,
    /** When the network closed (or will close), or null. After `launchedOn`. */
    closedOn: zGameDate.nullable(),
    logoRef: zImageRef,
  })
  .superRefine((network, context) => {
    if (network.closedOn !== null && compareDates(network.closedOn, network.launchedOn) <= 0) {
      context.addIssue({
        code: 'custom',
        message: 'closedOn must be after launchedOn',
        path: ['closedOn'],
      });
    }
  });

export type Network = z.infer<typeof NetworkSchema>;

/** The part of a network `coveredRegionIds` reads. */
export interface CoverageHolder {
  readonly coverage: {
    readonly continentIds: readonly ContinentId[];
    readonly countryIds: readonly CountryId[];
    readonly regionIds: readonly RegionId[];
  };
}

/**
 * Every region a network covers, in ascending ID order without duplicates: the regions of each
 * listed continent's countries, the regions of each listed country, and each listed region. IDs
 * that do not resolve to a row are left out (`checkWorld` reports them as dangling references).
 */
export function coveredRegionIds(network: CoverageHolder, view: WorldView): RegionId[] {
  const countries = tableOf(view, countriesTable);
  const regions = tableOf(view, regionsTable);
  const covered = new Set<RegionId>();
  const addCountry = (countryId: CountryId): void => {
    for (const region of regions.lookup('byCountry', countryId)) {
      covered.add(region.id);
    }
  };
  for (const continentId of network.coverage.continentIds) {
    for (const country of countries.lookup('byContinent', continentId)) {
      addCountry(country.id);
    }
  }
  for (const countryId of network.coverage.countryIds) {
    addCountry(countryId);
  }
  for (const regionId of network.coverage.regionIds) {
    if (regions.has(regionId)) {
      covered.add(regionId);
    }
  }
  return [...covered].sort(compareIds);
}

export const networksTable = defineTable({
  kind: 'network',
  name: 'networks',
  schema: NetworkSchema,
  refs: [
    { path: 'coverage.continentIds[]', target: 'continent', nullable: false },
    { path: 'coverage.countryIds[]', target: 'country', nullable: false },
    { path: 'coverage.regionIds[]', target: 'region', nullable: false },
    { path: 'ownerPromotionId', target: 'promotion', nullable: true },
  ],
  indexes: [{ name: 'byKind', key: (network) => network.kind }],
});
