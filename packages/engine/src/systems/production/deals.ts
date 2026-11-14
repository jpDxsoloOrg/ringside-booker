/**
 * The deal that holds a promotion's camera up: any active broadcast deal on the day.
 *
 * Design: docs/design/production.md#tv-camera-minimum. Any network kind counts (TV, pay-per-view
 * and streaming all need cameras). A deal runs from `startsOn` up to the day before `endsOn` (the
 * first day it no longer runs). Deal fees are not read.
 */

import { isAfter, isBefore, type GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { Deal } from '../../model/entities/deal';
import type { GameWorldView } from '../../model/tables';

/** True when `deal` is active and running on `date`. */
export function dealRunsOn(deal: Deal, date: GameDate): boolean {
  return deal.status === 'active' && !isAfter(deal.startsOn, date) && isBefore(date, deal.endsOn);
}

/** The promotion's active broadcast deal on `date` with the lowest id, or null. */
export function activeBroadcastDeal(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): Deal | null {
  // `lookup` lists rows in ascending id order, so the first match is the lowest id.
  return (
    read.tables.deals.lookup('byPromotion', promotionId).find((deal) => dealRunsOn(deal, date)) ??
    null
  );
}
