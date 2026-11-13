/**
 * The production system's domain events. Payloads carry ids and primitives only.
 * See docs/design/production.md#changing-a-level.
 */

import type { PromotionId } from '../../core/ids';
import type { ProductionArea } from '../../model/entities/promotion';

/** Who changed a level: the player's command, or the rival desk calling the door directly. */
export type ProductionChangeSource = 'command' | 'ai';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A promotion set one production area to a new level through `changeProductionLevel`. `fee`
     * is the upgrade fee paid, in cents (0 when the level went down).
     */
    'production.levelChanged': {
      promotionId: PromotionId;
      area: ProductionArea;
      from: number;
      to: number;
      fee: number;
      source: ProductionChangeSource;
    };
  }
}

export {};
