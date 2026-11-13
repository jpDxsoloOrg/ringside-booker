/**
 * The office system's queries (DAY2-02): `office.fanBase`, a promotion's headline popularity with
 * the full continent → country → region drill-down the Fan base sheet draws with WRK1's
 * `PopularityDrilldown`.
 *
 * Popularity is public, so any viewer may ask about any promotion. The headline comes from the
 * stored trace when there is one (the same entry `sim.status` reads), otherwise it is built on the
 * read; the drill-down is always built on the read, so nothing new is kept in the trace store.
 *
 * Design: docs/design/office.md#headline-popularity.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { PromotionId } from '../../core/ids';
import { isFullTrace, type TraceRef } from '../../core/trace/store';
import { zId } from '../../model/primitives';
import {
  popularityRollup,
  popularityRollupView,
  type PopularityRollupView,
} from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';
import { headlinePopularityOf } from './popularity';
import { popularityTraceRef } from './traces';
import type { HeadlineScope } from './tunables';

/** The reason code when the viewer runs no promotion and names none. */
export const NO_PROMOTION = 'noPromotion';
/** The reason code for a promotion ID that is not in the world. */
export const UNKNOWN_PROMOTION = 'unknownPromotion';

/** `office.fanBase`: one promotion's headline popularity and where its fans are. */
export interface FanBaseView {
  promotionId: PromotionId;
  name: string;
  headline: {
    /** 0..100, exact; screens round it. */
    value: number;
    /** The Why?'s root label, such as "Altura Wrestling popularity". */
    label: string;
    /** The stored Why? to open with `trace.get`, or null when none is stored yet. */
    traceRef: TraceRef | null;
  };
  /** Which roll-up level the headline is (`office.popularity.headlineScope`). */
  scope: HeadlineScope;
  /** World → continents → countries → regions, each derived level with its trace. */
  rollup: PopularityRollupView;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'office.fanBase': { args: { promotionId?: PromotionId }; result: FanBaseView };
  }
}

export const fanBaseQuery: QueryDefinition<'office.fanBase'> = defineQuery('office.fanBase', {
  args: z.strictObject({ promotionId: zId('promotion').exactOptional() }),
  run: (ctx, args) => {
    const promotionId = args.promotionId ?? viewerPromotionIds(ctx.read, ctx.viewer)[0];
    if (promotionId === undefined) {
      return refuseQuery({
        code: NO_PROMOTION,
        message: "You don't run a promotion, so pick one to look at",
        field: 'promotionId',
      });
    }
    const promotion = ctx.read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      return refuseQuery({
        code: UNKNOWN_PROMOTION,
        message: 'There is no such promotion',
        field: 'promotionId',
      });
    }
    const ref = popularityTraceRef(promotion.id);
    const stored = ctx.traces.get(ref);
    let headline: FanBaseView['headline'];
    if (stored !== undefined && typeof stored.value === 'number') {
      headline = {
        value: stored.value,
        label: isFullTrace(stored) ? stored.trace.label : stored.label,
        traceRef: ref,
      };
    } else {
      const built = headlinePopularityOf(ctx.read, promotion.id, ctx.tunables, ctx.date);
      headline = { value: built.value, label: built.trace.label, traceRef: null };
    }
    const geography = geographyOf(ctx.read);
    return {
      promotionId: promotion.id,
      name: promotion.name,
      headline,
      scope: ctx.tunables.get('office.popularity.headlineScope'),
      rollup: popularityRollupView(popularityRollup(promotion.regionalPop, geography), geography),
    };
  },
});

export const officeQueries: readonly QueryDefinition[] = [fanBaseQuery];
