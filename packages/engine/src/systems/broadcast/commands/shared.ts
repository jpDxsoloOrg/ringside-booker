/**
 * What the deal commands share (ECO8-05): the controller rule, the "own active deal" rule and the
 * valuation refusals turned into command reasons. Design: docs/design/broadcast.md#commands.
 */

import { controlsPromotion } from '../../../core/api/controller';
import type { Controller } from '../../../core/api/controller';
import type { Reason } from '../../../core/api/result';
import type { DealId, EventDefinitionId, NetworkId, PromotionId } from '../../../core/ids';
import type { Deal } from '../../../model/entities/deal';
import type { GameWorldView } from '../../../model/tables';
import type { DealValuation } from '../valuation';
import {
  NOT_YOUR_PROMOTION,
  NOT_YOUR_SHOW,
  UNKNOWN_DEAL,
  UNKNOWN_NETWORK,
  UNKNOWN_PROMOTION,
  UNKNOWN_SHOW,
} from '../queries/networks';

export const DEAL_NOT_ACTIVE = 'dealNotActive';

export const NOT_YOUR_PROMOTION_DEAL_MESSAGE =
  "Only the promotion's own management can make its TV deals";

/** Why a promotion cannot be acted for, or null when the issuer runs it. */
export function promotionReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  issuedBy: Controller,
): Reason[] {
  if (read.tables.promotions.get(promotionId) === undefined) {
    return [
      { code: UNKNOWN_PROMOTION, message: 'There is no such promotion', field: 'promotionId' },
    ];
  }
  if (!controlsPromotion(read, promotionId, issuedBy)) {
    return [
      {
        code: NOT_YOUR_PROMOTION,
        message: NOT_YOUR_PROMOTION_DEAL_MESSAGE,
        subject: { kind: 'promotion', id: promotionId },
      },
    ];
  }
  return [];
}

/** Why the network or the show cannot be dealt for, or an empty list. */
export function showReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  networkId: NetworkId,
  eventDefinitionId: EventDefinitionId | null,
): Reason[] {
  const network = read.tables.networks.get(networkId);
  if (
    network === undefined ||
    (network.ownerPromotionId !== null && network.ownerPromotionId !== promotionId)
  ) {
    return [
      {
        code: UNKNOWN_NETWORK,
        message: 'There is no such network to deal with',
        field: 'networkId',
      },
    ];
  }
  if (eventDefinitionId === null) {
    return [];
  }
  const definition = read.tables.eventDefinitions.get(eventDefinitionId);
  if (definition === undefined) {
    return [{ code: UNKNOWN_SHOW, message: 'There is no such show', field: 'eventDefinitionId' }];
  }
  if (definition.promotionId !== promotionId) {
    return [
      {
        code: NOT_YOUR_SHOW,
        message: `${definition.name} isn't one of your shows`,
        field: 'eventDefinitionId',
      },
    ];
  }
  return [];
}

/** The deal, when it exists, the issuer runs its promotion and it is active; else the reasons. */
export function ownActiveDeal(
  read: GameWorldView,
  dealId: DealId,
  issuedBy: Controller,
): { deal: Deal; reasons: [] } | { deal: null; reasons: Reason[] } {
  const deal = read.tables.deals.get(dealId);
  if (deal === undefined) {
    return {
      deal: null,
      reasons: [{ code: UNKNOWN_DEAL, message: 'There is no such deal', field: 'dealId' }],
    };
  }
  const reasons = promotionReasons(read, deal.promotionId, issuedBy);
  if (reasons.length > 0) {
    return { deal: null, reasons };
  }
  if (deal.status !== 'active') {
    return {
      deal: null,
      reasons: [
        {
          code: DEAL_NOT_ACTIVE,
          message: 'This deal is no longer running',
          subject: { kind: 'deal', id: deal.id },
        },
      ],
    };
  }
  return { deal, reasons: [] };
}

/** Every refusal of a valuation as a command reason about the network. */
export function refusalReasons(valuation: DealValuation, networkId: NetworkId): Reason[] {
  return valuation.refusals.map((refusal) => ({
    code: refusal.code,
    message: refusal.message,
    subject: { kind: 'network', id: networkId },
  }));
}
