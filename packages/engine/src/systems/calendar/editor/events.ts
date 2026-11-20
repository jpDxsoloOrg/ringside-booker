/**
 * The schedule editor's domain events: ids, dates and counts only.
 *
 * Design notes: docs/design/day-pipeline.md#domain-events.
 */

import type { GameDate } from '../../../core/date';
import type { EventDefinitionId, EventInstanceId, PromotionId } from '../../../core/ids';

declare module '../../../core/events/types' {
  interface DomainEventMap {
    /** A promotion started a new recurring show (`calendar.createDefinition`). */
    'eventDefinition.created': { eventDefinitionId: EventDefinitionId; promotionId: PromotionId };
    /**
     * A recurring show was changed and its future shows re-synced: how many dates were added,
     * removed (deleted or cancelled) and kept as they were.
     */
    'eventDefinition.updated': {
      eventDefinitionId: EventDefinitionId;
      promotionId: PromotionId;
      added: number;
      removed: number;
      kept: number;
    };
    /** A recurring show was retired: it produces no show after `activeUntil`. */
    'eventDefinition.retired': {
      eventDefinitionId: EventDefinitionId;
      promotionId: PromotionId;
      activeUntil: GameDate;
    };
    /** A one-off special was put on the calendar (`calendar.addOneOff`). */
    'show.added': { eventInstanceId: EventInstanceId; promotionId: PromotionId; date: GameDate };
  }
}

export {};
