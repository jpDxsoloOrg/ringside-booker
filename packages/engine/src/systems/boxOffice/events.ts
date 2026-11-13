/**
 * The box office system's domain events. EVT6-05 (the show's settlement) adds its own here by
 * merging `DomainEventMap`.
 */

import type { EventInstanceId, PromotionId, VenueId } from '../../core/ids';
import type { GenericVenueTier } from '../../model/entities/venue';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A show was given a venue (EVT6-02): a real one (`venueId`) or a generic local one
     * (`genericTier`), never both. `auto` is true when the game picked it, false when the player
     * chose it.
     */
    'show.venueChosen': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      venueId: VenueId | null;
      genericTier: GenericVenueTier | null;
      auto: boolean;
    };
  }
}

export {};
