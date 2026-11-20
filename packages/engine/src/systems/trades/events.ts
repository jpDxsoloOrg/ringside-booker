/**
 * The trades' domain events and random stream (TRD-01, TRD-03). Payloads are ids and small
 * primitives only; never an amount of money (D-07).
 *
 * Design: docs/design/trades.md#events.
 */

import type { PromotionId, TradeId } from '../../core/ids';
import type { TradeAnswerKind, TradeStatus } from '../../model/entities/trade';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A new offer is on the table: the first one of a trade, or a counter from either side. */
    'trade.offered': {
      tradeId: TradeId;
      by: PromotionId;
      to: PromotionId;
      round: number;
      /** True when a computer promotion started the talk on its own (TRD-03). */
      rivalInitiated: boolean;
    };
    /** A computer promotion answered an offer. */
    'trade.answered': { tradeId: TradeId; by: PromotionId; answer: TradeAnswerKind };
    /** The workers moved. */
    'trade.completed': { tradeId: TradeId; promotionIds: PromotionId[]; workers: number };
    /** A trade closed without the workers moving. */
    'trade.closed': { tradeId: TradeId; status: Exclude<TradeStatus, 'open' | 'completed'> };
  }
}

declare module '../../core/rng/streams' {
  interface StreamNames {
    /** Whether, and which, rival offers a player a trade this week (TRD-03). */
    'trades.rival-offer': true;
  }
}

/** The stream rival trade offers draw from. */
export const RIVAL_OFFER_STREAM = 'trades.rival-offer';
