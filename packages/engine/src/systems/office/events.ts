/**
 * The office system's domain events.
 */

import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** The weekly promotion history rows were written, one per listed promotion (id order). */
    'office.snapshotTaken': { date: GameDate; promotionIds: PromotionId[] };
  }
}

export {};
