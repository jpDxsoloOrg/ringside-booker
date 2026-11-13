/**
 * The card flow system's query: `production.ceiling`, a promotion's production ceiling and whether
 * it earns its shows the bonus slot, optionally for what-if levels (ECO7's change dialog shows the
 * after-value with them). Production levels are public, so any viewer may ask about any
 * promotion. Traces are returned inline; nothing is written or recorded.
 *
 * Design: docs/design/card-flow.md#production-ceiling and #bonus-slot.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { PromotionId } from '../../core/ids';
import type { TraceNode } from '../../core/trace';
import type { EventImportance } from '../../model/entities/event-definition';
import { PRODUCTION_LEVEL_MAX, PRODUCTION_LEVEL_MIN } from '../../model/entities/promotion';
import { zId } from '../../model/primitives';
import { bonusSlotProductionCheck } from './formulas/bonusSlot';
import { ceilingLevelsOf, productionCeiling, type CeilingArea } from './formulas/productionCeiling';

/** What the player reads when the promotion id is unknown. */
export const PRODUCTION_CEILING_UNKNOWN_PROMOTION_MESSAGE = "That promotion doesn't exist.";

export interface ProductionCeilingView {
  /** The ceiling, 0..100, not rounded. */
  ceiling: number;
  ceilingTrace: TraceNode;
  bonusSlot: {
    /** True when the ceiling reaches the threshold (shows still need the smallest importance). */
    qualifies: boolean;
    threshold: number;
    minImportance: EventImportance;
    trace: TraceNode;
  };
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'production.ceiling': {
      args: {
        promotionId: PromotionId;
        levels?: { [Area in CeilingArea]?: number | undefined } | undefined;
      };
      result: ProductionCeilingView;
    };
  }
}

const zLevel = z.number().int().min(PRODUCTION_LEVEL_MIN).max(PRODUCTION_LEVEL_MAX);

export const productionCeilingQuery: QueryDefinition<'production.ceiling'> = defineQuery(
  'production.ceiling',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      levels: z
        .strictObject({
          stage: zLevel.optional(),
          camera: zLevel.optional(),
          editing: zLevel.optional(),
          pyro: zLevel.optional(),
        })
        .optional(),
    }),
    run: (ctx, args) => {
      const promotion = ctx.read.tables.promotions.get(args.promotionId);
      if (promotion === undefined) {
        return refuseQuery({
          code: 'notFound',
          message: PRODUCTION_CEILING_UNKNOWN_PROMOTION_MESSAGE,
          field: 'promotionId',
        });
      }
      const stored = ceilingLevelsOf(ctx.read, args.promotionId);
      const override = args.levels ?? {};
      const ceiling = productionCeiling(
        {
          promotionName: promotion.name,
          levels: {
            stage: override.stage ?? stored.stage,
            camera: override.camera ?? stored.camera,
            editing: override.editing ?? stored.editing,
            pyro: override.pyro ?? stored.pyro,
          },
        },
        ctx.tunables,
      );
      const check = bonusSlotProductionCheck(ceiling, ctx.tunables);
      return {
        ceiling: ceiling.value,
        ceilingTrace: ceiling.trace,
        bonusSlot: {
          qualifies: check.value,
          threshold: ctx.tunables.get('production.bonusSlotThreshold'),
          minImportance: ctx.tunables.get('production.bonusSlotMinImportance'),
          trace: check.trace,
        },
      };
    },
  },
);

export const cardFlowQueries: readonly QueryDefinition[] = [productionCeilingQuery];
