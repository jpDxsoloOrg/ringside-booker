/**
 * The promotion popularity system's domain events. Payloads carry ids and primitives only.
 * See docs/design/promotion-popularity.md#after-every-show.
 */

import type { EventInstanceId, PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A completed show changed its promotion's popularity. `worldBefore` and `worldAfter` are the
     * population-weighted worldwide figures; the three counts are regions that went up, went down,
     * and had a gain cut by the monthly cap.
     */
    'showPopularity.changed': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      worldBefore: number;
      worldAfter: number;
      regionsGained: number;
      regionsLost: number;
      regionsCapped: number;
    };
  }
}

export {};
