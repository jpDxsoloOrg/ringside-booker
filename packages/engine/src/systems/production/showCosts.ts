/**
 * Per-show production costs (ECO7-05): every completed show, the player's and every rival's (on
 * screen or off it, D-01), pays its stage, camera, editing and pyro at that show's importance, as
 * one Production ledger row linked to the show with a Why? listing each area.
 *
 * The reaction runs on `show.completed`, so a cancelled show (which never completes) costs nothing,
 * and a show whose four areas are all at level 0 posts nothing. It reads the promotion's levels at
 * the moment the show completes. Posting twice is harmless: a show that already has its production
 * row is skipped, so a show the player ran before the day and the day itself never both pay.
 *
 * Design: docs/design/production.md#per-show-costs.
 */

import { yearMonthOf, type GameDate } from '../../core/date';
import { defineSubscription, type SubscriptionSpec } from '../../core/api/system';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { ledgerMonthKey } from '../../model/entities/ledger-entry';
import type { GameWorldView } from '../../model/tables';
import { postCost } from '../finance/phases';
import { productionShowCost } from './formulas/productionShowCost';

/** The subscription id of the reaction that posts a completed show's production cost. */
export const SHOW_PRODUCTION_COSTS_SUBSCRIPTION_ID = 'production.showCosts';

/** "Show production: Hardpan Friday". */
export function showProductionMemo(showName: string): string {
  return `Show production: ${showName}`;
}

/** True when the show's production row is already on the promotion's books. */
function alreadyPosted(
  read: GameWorldView,
  promotionId: PromotionId,
  eventInstanceId: EventInstanceId,
  dates: readonly GameDate[],
): boolean {
  const months = [...new Set(dates.map(yearMonthOf))];
  return months.some((month) =>
    read.tables.ledgerEntries
      .lookup('byPromotionMonth', ledgerMonthKey(promotionId, month))
      .some((row) => row.category === 'production' && row.refs.eventInstanceId === eventInstanceId),
  );
}

/**
 * Posts the production cost of the completed show `eventInstanceId` at its promotion's current
 * levels: one `production` row, memo "Show production: <show name>", `refs.eventInstanceId` set.
 * Does nothing for an unknown or not completed show, a closed promotion, a show already charged, or
 * a cost of 0.
 */
export function postShowProductionCost(ctx: StepContext, eventInstanceId: EventInstanceId): void {
  const instance = ctx.read.tables.eventInstances.get(eventInstanceId);
  if (instance?.status !== 'completed') {
    return;
  }
  const promotion = ctx.read.tables.promotions.get(instance.promotionId);
  if (promotion === undefined || promotion.status === 'closed') {
    return;
  }
  if (alreadyPosted(ctx.read, promotion.id, instance.id, [instance.date, ctx.date])) {
    ctx.log(`${instance.name}: show production already paid`);
    return;
  }
  const cost = productionShowCost(
    {
      promotionName: promotion.name,
      showName: instance.name,
      importance: instance.importance,
      levels: promotion.production,
    },
    { tunables: ctx.tunables },
  );
  // postCost posts nothing (and logs a line) for a show with no paid production.
  postCost(ctx, promotion.id, 'production', showProductionMemo(instance.name), cost, {
    eventInstanceId: instance.id,
  });
}

export const showProductionCostsSubscription: SubscriptionSpec<'show.completed'> =
  defineSubscription({
    id: SHOW_PRODUCTION_COSTS_SUBSCRIPTION_ID,
    type: 'show.completed',
    handler: (event, ctx) => {
      postShowProductionCost(ctx, event.payload.eventInstanceId);
    },
  });
