/**
 * The calendar's domain events.
 */

import type { GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A show was put on the books by the daily horizon phase. The opening schedule of a new game
     * publishes one `calendar.horizonExtended` instead, so listeners that need every show read the
     * `eventInstances` table when the world is created.
     */
    'show.scheduled': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      date: GameDate;
    };
    /** The stored schedule was filled from `from` through `through`; `created` counts the shows. */
    'calendar.horizonExtended': { from: GameDate; through: GameDate; created: number };
  }
}

export {};
