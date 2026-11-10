/**
 * The calendar's domain events.
 */

import type { GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import type { CancellationReason } from '../../model/entities/event-instance';

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
    /**
     * A show will not happen. `notRun`: its day ended with the show still open. `byPromotion`: its
     * controller called it off. `date` is the show's own date; the day it was cancelled is on the
     * row's `cancellation.on`.
     */
    'show.cancelled': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      date: GameDate;
      reason: CancellationReason;
    };
    /** The stored schedule was filled from `from` through `through`; `created` counts the shows. */
    'calendar.horizonExtended': { from: GameDate; through: GameDate; created: number };
  }
}

export {};
