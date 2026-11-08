/**
 * The new-game domain event.
 */

import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A new game was set up. Published once, as the first event of every world, after every setup
     * step has run. `promotionId` is the promotion the human controller `playerId` runs.
     */
    'world.created': {
      startDate: GameDate;
      seasonLengthDays: number;
      promotionId: PromotionId;
      playerId: string;
    };
  }
}

export {};
