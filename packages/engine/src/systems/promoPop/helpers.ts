/**
 * Read helpers over the per-show popularity records, for features that settle a show after its
 * popularity has moved (EVT6 attendance) or list a promotion's recent results (EVT5-04).
 *
 * Design: docs/design/promotion-popularity.md#after-every-show.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId, RegionId } from '../../core/ids';
import type { PopularityShowChange } from '../../model/entities/popularity-show-change';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { gainsForMonth } from './apply';

/** The stored record of one show, or undefined when there is none. */
export function showChangeOf(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
): DeepReadonly<PopularityShowChange> | undefined {
  return read.tables.popularityShowChanges.lookup('byEventInstance', eventInstanceId)[0];
}

/**
 * The promotion's popularity in `regionId` just before the show, as the record stored it, or null
 * when the show has no record or did not reach that region. A consumer settling the same show
 * later that day reads this instead of `regionalPop`, which already includes the show.
 */
export function popularityBeforeShow(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  regionId: RegionId,
): number | null {
  return showChangeOf(read, eventInstanceId)?.regions[regionId]?.before ?? null;
}

/** One show in `recentShowChanges`. */
export interface RecentShowChange {
  eventInstanceId: EventInstanceId;
  date: GameDate;
  showName: string;
  /** The change in worldwide popularity, in points. */
  worldChange: number;
}

/**
 * The promotion's newest show records (by date, then id), at most `limit` of them. A show whose
 * record was rolled up (POL4-08) counts with the worldwide change its summary kept.
 */
export function recentShowChanges(
  read: GameWorldView,
  promotionId: PromotionId,
  limit: number,
): RecentShowChange[] {
  const changes: RecentShowChange[] = read.tables.popularityShowChanges
    .lookup('byPromotion', promotionId)
    .map((row) => ({
      eventInstanceId: row.eventInstanceId,
      date: row.date,
      showName: read.tables.eventInstances.get(row.eventInstanceId)?.name ?? row.eventInstanceId,
      worldChange: row.worldAfter - row.worldBefore,
    }));
  const recorded = new Set(changes.map((change) => change.eventInstanceId));
  for (const instance of read.tables.eventInstances.lookup('byPromotion', promotionId)) {
    const world = instance.result?.history?.world ?? null;
    if (world !== null && !recorded.has(instance.id)) {
      changes.push({
        eventInstanceId: instance.id,
        date: instance.date,
        showName: instance.name,
        worldChange: world.after - world.before,
      });
    }
  }
  return changes
    .sort(
      (left, right) =>
        compareDates(right.date, left.date) ||
        compareIds(right.eventInstanceId, left.eventInstanceId),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * What the promotion's shows have gained it in each region in `date`'s month so far. Empty when
 * the stored tally belongs to another month, or the promotion does not exist.
 */
export function monthlyGainsOf(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): Record<RegionId, number> {
  const promotion = read.tables.promotions.get(promotionId);
  return promotion === undefined ? {} : { ...gainsForMonth(promotion, date) };
}
