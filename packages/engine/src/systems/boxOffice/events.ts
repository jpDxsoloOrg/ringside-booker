/**
 * The box office system's domain events: `show.venueChosen` (EVT6-02) and `show.settled`
 * (EVT6-05).
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
    /**
     * A completed show was settled (EVT6-05): its real crowd was rolled and its tickets, venue rent
     * and live merch posted. Published once per show, player's and rivals' alike, on the show's
     * own date. Money is in whole cents: `gate` is ticket sales before workers' shares and `net`
     * the sum of the show's three box office ledger rows (negative when rent was more than it took).
     */
    'show.settled': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      attendance: number;
      capacity: number;
      gate: number;
      net: number;
    };
  }
}

export {};
