/**
 * Popularity show changes: what one completed show did to its promotion's popularity, region by
 * region (EVT5-02).
 *
 * One row per show, written by the promotion popularity system right after `show.completed`. It
 * lists every region the show reached, including the ones where nothing changed, so a results page
 * can still say "about what fans expected" there weeks later, after the full Why? traces have been
 * thinned out. `before` and `after` are what the popularity door actually stored. Rows of shows
 * older than `history.keepDetailDays` are deleted by the weekly history roll-up (POL4-08), which
 * keeps the worldwide before and after on the show's summary.
 *
 * Design: docs/design/promotion-popularity.md and docs/design/data-model.md.
 */

import { z } from 'zod';
import type { NetworkId } from '../../core/ids';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { networksTable } from './network';

/** How a region saw the show: in person, as a neighbour, or on television. */
export const POPULARITY_REACH_SOURCES = ['show', 'neighbour', 'tv'] as const;
export type PopularityReachSource = (typeof POPULARITY_REACH_SOURCES)[number];

export const PopularityShowRegionSchema = z
  .strictObject({
    /** The strongest route that reached the region. */
    source: z.enum(POPULARITY_REACH_SOURCES),
    /** The network of a `tv` route; null for the other routes. */
    networkId: zId('network').nullable(),
    /** How much of the show the region saw, above 0 and at most 1. */
    weight: z.number().gt(0).max(1),
    /** The score fans in the region expected. */
    expectation: zStat,
    /** The promotion's popularity there before the show (0 when none was stored). */
    before: zStat,
    /** The popularity the door stored after the show (0 when the region was removed). */
    after: zStat,
    /** True when the monthly gain cap made the gain smaller, including down to nothing. */
    capped: z.boolean(),
  })
  .refine((region) => (region.networkId !== null) === (region.source === 'tv'), {
    message: 'networkId is set exactly when source is tv',
    path: ['networkId'],
  });

export type PopularityShowRegion = z.infer<typeof PopularityShowRegionSchema>;

export const PopularityShowChangeSchema = z.strictObject({
  id: zId('popularityShowChange'),
  eventInstanceId: zId('eventInstance'),
  promotionId: zId('promotion'),
  /** The day the show ran. */
  date: zGameDate,
  /** The show's score, copied from its result. */
  score: zStat,
  /** The promotion's worldwide popularity (population-weighted) just before the show. */
  worldBefore: zStat,
  /** The same just after it. */
  worldAfter: zStat,
  /** Every region the show reached, keyed by region. */
  regions: z.record(zId('region'), PopularityShowRegionSchema),
});

export type PopularityShowChange = z.infer<typeof PopularityShowChangeSchema>;

/** The networks named by `regions{}.networkId` that are not in the world. */
function missingNetworkIssues(view: WorldView): IntegrityIssue[] {
  const networks = tableOf(view, networksTable);
  const issues: IntegrityIssue[] = [];
  for (const row of tableOf(view, popularityShowChangesTable).values()) {
    for (const [regionId, region] of Object.entries(row.regions)) {
      const networkId: NetworkId | null = region.networkId;
      if (networkId !== null && !networks.has(networkId)) {
        issues.push({
          code: 'popularityShowChange.unknownNetwork',
          table: 'popularityShowChanges',
          id: row.id,
          path: `regions{${regionId}}.networkId`,
          message: `Show change ${row.id} names network ${networkId}, which does not exist`,
        });
      }
    }
  }
  return issues;
}

export const popularityShowChangesTable = defineTable({
  kind: 'popularityShowChange',
  name: 'popularityShowChanges',
  schema: PopularityShowChangeSchema,
  refs: [
    { path: 'eventInstanceId', target: 'eventInstance', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'regions{}', target: 'region', nullable: false },
  ],
  indexes: [
    { name: 'byEventInstance', key: (row) => row.eventInstanceId, unique: true },
    { name: 'byPromotion', key: (row) => row.promotionId },
  ],
  invariants: [
    {
      // A `{}` (record keys) marker must be the last segment of a ref path, so the network inside
      // each region entry is checked here instead of in `refs`.
      name: 'networksExist',
      check: missingNetworkIssues,
    },
  ],
});
