/**
 * `production.setLevel` (ECO7-02): the player sets one production area to a new level.
 *
 * Raising pays the upgrade fee (a Production row in the ledger with a Why?); lowering is free.
 * Validation is {@link checkLevelChange}, the same check the change dialog shows, plus the one
 * controller rule every command uses (`controlsPromotion`, AIP1-07). `apply` goes through the
 * write door {@link changeProductionLevel}.
 *
 * Design: docs/design/production.md#changing-a-level.
 */

import { z } from 'zod';
import { defineCommand, type CommandDefinition } from '../../core/api/command';
import { controlsPromotion } from '../../core/api/controller';
import type { PromotionId } from '../../core/ids';
import { PRODUCTION_AREAS, type ProductionArea } from '../../model/entities/promotion';
import { zId } from '../../model/primitives';
import { checkLevelChange, changeProductionLevel } from './door';

export interface SetProductionLevelArgs {
  promotionId: PromotionId;
  area: ProductionArea;
  level: number;
}

/** What `production.setLevel` did. `fee` is the upgrade fee paid, in cents. */
export interface SetProductionLevelResult {
  area: ProductionArea;
  from: number;
  to: number;
  fee: number;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'production.setLevel': { args: SetProductionLevelArgs; result: SetProductionLevelResult };
  }
}

/** The message for a promotion the issuer does not run. */
export const NOT_YOUR_PROMOTION_MESSAGE =
  "Only the promotion's own management can change its production";

export const setProductionLevelCommand: CommandDefinition<'production.setLevel'> = defineCommand(
  'production.setLevel',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      area: z.enum(PRODUCTION_AREAS),
      level: z.number().int(),
    }),
    validate: (read, args, issuedBy, env) => {
      const promotion = read.tables.promotions.get(args.promotionId);
      if (promotion === undefined) {
        return [{ code: 'notFound', message: 'There is no such promotion', field: 'promotionId' }];
      }
      if (!controlsPromotion(read, promotion.id, issuedBy)) {
        return [
          {
            code: 'production.notYourPromotion',
            message: NOT_YOUR_PROMOTION_MESSAGE,
            subject: { kind: 'promotion', id: promotion.id },
          },
        ];
      }
      return checkLevelChange(read, args, env.tunables, read.meta.currentDate).reasons;
    },
    apply: (ctx, args) => {
      const from = ctx.read.tables.promotions.require(args.promotionId).production[args.area];
      const { fee } = changeProductionLevel(ctx, { ...args, source: 'command' });
      return { area: args.area, from, to: args.level, fee };
    },
  },
);

export const productionCommands = [setProductionLevelCommand] as const;
