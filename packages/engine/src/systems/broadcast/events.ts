/**
 * The broadcast system's domain events (ECO8-01). Payloads carry ids and primitives only.
 * Declared here once for the whole feature: the player's deal commands and the rivals' deal-making
 * (ECO10) publish the same `broadcast.dealSigned` rather than declaring a second one.
 * See docs/design/broadcast.md and docs/design/day-pipeline.md#domain-events.
 */

import type { GameDate } from '../../core/date';
import type { AiringId, DealId, EventInstanceId, NetworkId, PromotionId } from '../../core/ids';
import type { AiringMissReason } from '../../model/entities/airing';
import type { DealEndReason } from '../../model/entities/deal';

/**
 * How a deal is doing, as deal health (ECO8-05) judges it and `broadcast.dealWarned` reports it:
 * from Safe to Cancelling. ECO8-05's `dealHealth` formula returns one of these.
 */
export const DEAL_RISKS = ['safe', 'watch', 'atRisk', 'cancelling'] as const;
export type DealRisk = (typeof DEAL_RISKS)[number];

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A deal aired a show: an `aired` row was written to `airings`. */
    'broadcast.aired': {
      airingId: AiringId;
      dealId: DealId;
      promotionId: PromotionId;
      networkId: NetworkId;
      eventInstanceId: EventInstanceId | null;
      airDate: GameDate;
      viewers: number;
    };
    /** A show a deal was due to air did not air: a `missed` row was written to `airings`. */
    'broadcast.missed': {
      airingId: AiringId;
      dealId: DealId;
      promotionId: PromotionId;
      eventInstanceId: EventInstanceId | null;
      airDate: GameDate;
      reason: AiringMissReason;
    };
    /** A promotion and a network signed a deal (the player's or a rival's). */
    'broadcast.dealSigned': {
      dealId: DealId;
      promotionId: PromotionId;
      networkId: NetworkId;
    };
    /** A deal's terms were renegotiated. */
    'broadcast.dealRenegotiated': {
      dealId: DealId;
      promotionId: PromotionId;
    };
    /** A deal ended, and why. */
    'broadcast.dealEnded': {
      dealId: DealId;
      promotionId: PromotionId;
      networkId: NetworkId;
      reason: DealEndReason;
    };
    /** The network warned the promotion a deal is at risk. */
    'broadcast.dealWarned': {
      dealId: DealId;
      promotionId: PromotionId;
      risk: DealRisk;
    };
  }
}
