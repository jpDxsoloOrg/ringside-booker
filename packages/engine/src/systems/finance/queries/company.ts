/**
 * `finance.company`: how big a promotion is (its reach and its size label), with both Why? traces
 * inline.
 *
 * Public: company size is common knowledge and is built only from popularity, which every viewer
 * can already see, so any viewer may ask about any promotion. It never returns cash or ledger
 * figures. The traces are built on the read, so nothing is kept in the trace store.
 *
 * Design: docs/design/finances.md#reach-and-size.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import type { PromotionId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import { zId } from '../../../model/primitives';
import {
  PROMOTION_SIZE_LABELS,
  sizeThresholds,
  THRESHOLD_SIZES,
  type PromotionSize,
} from '../formulas/promotionSize';
import { reachOf } from '../reach';

/** The reason code for a promotion ID that is not in the world. */
export const UNKNOWN_PROMOTION = 'unknownPromotion';

/** The next size up and the reach it starts at. */
export interface CompanyNextSize {
  size: PromotionSize;
  label: string;
  /** The reach threshold of that size. */
  at: number;
}

/** `finance.company`: one promotion's reach and size. */
export interface CompanyView {
  promotionId: PromotionId;
  name: string;
  /** 0 to 100, exact; screens round it to one decimal. */
  reach: number;
  reachTrace: TraceNode;
  size: PromotionSize;
  sizeLabel: string;
  sizeTrace: TraceNode;
  /** The smallest larger size whose threshold is above reach, or null when there is none. */
  nextSize: CompanyNextSize | null;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'finance.company': { args: { promotionId: PromotionId }; result: CompanyView };
  }
}

export const companyQuery: QueryDefinition<'finance.company'> = defineQuery('finance.company', {
  args: z.strictObject({ promotionId: zId('promotion') }),
  run: (ctx, args) => {
    const promotion = ctx.read.tables.promotions.get(args.promotionId);
    if (promotion === undefined) {
      return refuseQuery({
        code: UNKNOWN_PROMOTION,
        message: 'There is no such promotion',
        field: 'promotionId',
      });
    }
    const { reach, size } = reachOf(ctx.read, promotion.id, ctx.tunables);
    const thresholds = sizeThresholds(ctx.tunables);
    const sizeIndex = THRESHOLD_SIZES.findIndex((candidate) => candidate === size.value);
    const next = THRESHOLD_SIZES.slice(sizeIndex + 1).find(
      (candidate) => thresholds[candidate] > reach.value,
    );
    return {
      promotionId: promotion.id,
      name: promotion.name,
      reach: reach.value,
      reachTrace: reach.trace,
      size: size.value,
      sizeLabel: PROMOTION_SIZE_LABELS[size.value],
      sizeTrace: size.trace,
      nextSize:
        next === undefined
          ? null
          : { size: next, label: PROMOTION_SIZE_LABELS[next], at: thresholds[next] },
    };
  },
});
