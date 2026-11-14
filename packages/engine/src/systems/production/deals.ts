/**
 * The deal that holds a promotion's camera up: any broadcast deal in force on the day.
 *
 * Design: docs/design/production.md#tv-camera-minimum. Any network kind counts (TV, pay-per-view
 * and streaming all need cameras). Since ECO8-07 this is ECO8's own rule (`firstDealInForce`): a
 * deal runs from `startsOn` up to the day before `endsOn` (the first day it no longer runs), while
 * its network is still on air, so the camera floor and the airings always agree. Deal fees are not
 * read.
 */

import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { Deal } from '../../model/entities/deal';
import type { GameWorldView } from '../../model/tables';
import { dealInForce, firstDealInForce } from '../broadcast/coverage';

/** True when `deal` is in force on `date`, its network on air too. */
export function dealRunsOn(read: GameWorldView, deal: Deal, date: GameDate): boolean {
  const network = read.tables.networks.get(deal.networkId);
  return network !== undefined && dealInForce(deal, network, date);
}

/** The promotion's broadcast deal in force on `date` with the lowest id, or null. */
export function activeBroadcastDeal(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): Deal | null {
  return firstDealInForce(read, promotionId, date);
}
