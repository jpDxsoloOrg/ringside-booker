/**
 * The rival booker's domain events (AIP4-05). IDs and primitives only. See
 * docs/design/day-pipeline.md#domain-events and docs/design/rival-booking.md#show-day.
 */

import type { BrandId, EventInstanceId, PromotionId } from '../../../core/ids';

declare module '../../../core/events/types' {
  interface DomainEventMap {
    /**
     * A computer-run show got its card on show day (`aip.bookShow`) and is booked. A show the
     * rival booker calls off publishes `show.cancelled` instead.
     */
    'aip.cardBooked': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      /** Segments on the card, kept ones included. */
      segmentCount: number;
      /** Matches on the card with at least one title on the line. */
      titleMatchCount: number;
    };
  }
}

export {};
