/**
 * TV deals on the news wire (ECO8-07, the ECO8 part of DAY1-06's integration).
 *
 * `broadcast.dealSigned` posts a `business` story (topic `deal-signed`) for any promotion, the
 * player's or a rival's (ECO10's rival deal-making publishes the same event): importance 2 for a
 * prime-time slot, else 1. That a deal exists is public (who airs what, on which network, see
 * broadcast.md#queries-and-visibility), so the story names the promotion, the network and the
 * show, and never the fee, the rate or the airtime (D-07): what a network pays stays private.
 * Dedupe `deal-signed:<dealId>`.
 *
 * Design: docs/design/broadcast.md#seams and docs/design/news.md#integration.
 */

import { defineSubscription, type SubscriptionSpec } from '../../core/api/system';
import type { DealId } from '../../core/ids';
import type { Deal } from '../../model/entities/deal';
import type { Network } from '../../model/entities/network';
import type { GameWorldView } from '../../model/tables';
import { postNews } from '../news/post';
import { registerNewsTopic } from '../news/topics';

export const DEAL_SIGNED_TOPIC = 'deal-signed';

registerNewsTopic(DEAL_SIGNED_TOPIC, { params: ['promotionId', 'network', 'show'] });

export const DEAL_SIGNED_NEWS_SUBSCRIPTION_ID = 'broadcast.newsOnDealSigned';

/** `deal-signed:<dealId>` */
export function dealSignedDedupeKey(dealId: DealId): string {
  return `deal-signed:${dealId}`;
}

/**
 * What the deal carries, as the story says it: the show's name, or "every major show" (a
 * promotion-wide pay-per-view deal) / "every televised show" (any other promotion-wide deal).
 */
export function dealShowText(read: GameWorldView, deal: Deal, network: Network): string {
  if (deal.eventDefinitionId !== null) {
    const definition = read.tables.eventDefinitions.get(deal.eventDefinitionId);
    if (definition !== undefined) {
      return definition.name;
    }
  }
  return network.kind === 'ppv' ? 'every major show' : 'every televised show';
}

/** `broadcast.dealSigned` → a `deal-signed` story. */
export const dealSignedNewsSubscription: SubscriptionSpec<'broadcast.dealSigned'> =
  defineSubscription({
    id: DEAL_SIGNED_NEWS_SUBSCRIPTION_ID,
    type: 'broadcast.dealSigned',
    handler: (event, ctx) => {
      const { dealId, promotionId, networkId } = event.payload;
      const deal = ctx.read.tables.deals.get(dealId);
      const network = ctx.read.tables.networks.get(networkId);
      if (deal === undefined || network === undefined) {
        return;
      }
      postNews(ctx, {
        kind: 'business',
        topic: DEAL_SIGNED_TOPIC,
        params: {
          promotionId,
          network: network.name,
          show: dealShowText(ctx.read, deal, network),
        },
        refs: { promotionIds: [promotionId] },
        importance: deal.timeslot === 'primeTime' ? 2 : 1,
        dedupeKey: dealSignedDedupeKey(dealId),
      });
    },
  });
