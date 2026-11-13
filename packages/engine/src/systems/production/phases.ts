/**
 * The production system's day phases (ECO7-03): what keeps production levels mattering over time,
 * for every promotion under one rule set (D-01).
 *
 * - `production.monthlyOverhead` (money group, the 1st of each month): each active promotion pays
 *   its music and writing (ledger category Production), marketing (Marketing) and back office
 *   (Back office) overhead for the month ahead, at the levels it has that morning. One ledger row
 *   per category above 0, each with its own Why?, through `postMoney`.
 * - `production.popularityDrag` (growth group, daily): in every region where an active
 *   promotion's popularity is above its popularity ceiling, popularity falls a little each day
 *   until it reaches the ceiling. One popularity door call per promotion per day, with each
 *   region's own drag, so the change has the same clamp, trace and `popularity.changed` event as
 *   every other popularity change. It never acts at or under the ceiling and never pushes a region
 *   below it.
 *
 * Neither phase rolls anything or needs the player's attention.
 * Design: docs/design/production.md#monthly-overhead and #popularity-drag.
 */

import { yearMonthOf } from '../../core/date';
import type { PromotionId, RegionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { startCalc } from '../../core/trace/calc';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import type { Promotion } from '../../model/entities/promotion';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { monthLabel } from '../finance/months';
import { postCost } from '../finance/phases';
import { applyPopularityChange } from '../workers/doors';
import { PRODUCTION_LEDGER_CATEGORIES } from './areas';
import { popularityCeiling } from './formulas/popularityCeiling';
import { popularityDrag } from './formulas/popularityDrag';
import {
  PRODUCTION_CATEGORY_LABELS,
  productionMonthlyCost,
} from './formulas/productionMonthlyCost';
import { POPULARITY_DRAG_DOC_REF } from './formulas/shared';

export const MONTHLY_OVERHEAD_PHASE_ID = 'production.monthlyOverhead';
export const POPULARITY_DRAG_PHASE_ID = 'production.popularityDrag';

/**
 * The trace of a promotion's last monthly overhead (the total), for the Production screen's "last
 * charged" line. Id: the promotion id. Each ledger row keeps its own Why? under the finance kinds.
 */
export const MONTHLY_OVERHEAD_TRACE_KIND = 'production.monthlyOverhead';

/** The reason key the popularity door and its `popularity.changed` event carry for the drag. */
export const POPULARITY_DRAG_REASON_KEY = 'production.popularityDrag';
/** The drag's reason as the player reads it. */
export const POPULARITY_DRAG_REASON_LABEL =
  "Marketing and back office can't support this popularity";

/** Popularity is stored in hundredths of a point (the popularity door rounds to them). */
const HUNDREDTHS = 100;

/** Where a promotion's last monthly overhead trace is stored. */
export function monthlyOverheadTraceRef(promotionId: PromotionId): TraceRef {
  return { kind: MONTHLY_OVERHEAD_TRACE_KIND, id: promotionId };
}

/** Active promotions, in id order. Dormant and closed promotions pay nothing and drift nowhere. */
function activePromotions(ctx: StepContext): readonly DeepReadonly<Promotion>[] {
  return ctx.read.tables.promotions.values().filter((promotion) => promotion.status === 'active');
}

/** "Production overhead for January 2026", "Back office overhead for January 2026". */
function overheadMemo(label: string, ctx: StepContext): string {
  return `${label} overhead for ${monthLabel(yearMonthOf(ctx.date))}`;
}

/** On the 1st of each month: up to three overhead rows per active promotion. */
export const monthlyOverheadPhase: PhaseDefinition = definePhase({
  id: MONTHLY_OVERHEAD_PHASE_ID,
  group: 'money',
  // After ECO1's payroll (10) and medical (20), and the slots ECO2 keeps (22, 30), so the 1st
  // reads in a stable order in the ledger.
  order: 35,
  cadence: { kind: 'monthly', day: 1 },
  run: (ctx) => {
    for (const promotion of activePromotions(ctx)) {
      const cost = productionMonthlyCost(
        { promotionName: promotion.name, levels: promotion.production },
        { tunables: ctx.tunables },
      );
      for (const category of PRODUCTION_LEDGER_CATEGORIES) {
        // postCost posts nothing (and logs a line) when the category comes to 0.
        postCost(
          ctx,
          promotion.id,
          category,
          overheadMemo(PRODUCTION_CATEGORY_LABELS[category], ctx),
          cost.byCategory[category],
        );
      }
      if (cost.total.value > 0) {
        ctx.recordTrace(
          monthlyOverheadTraceRef(promotion.id),
          ctx.date,
          cost.total,
          // A rival's overhead keeps only a summary, like its ledger rows (POL4-06).
          promotion.controller.kind === 'human' ? {} : { summaryOnly: true },
        );
      }
    }
  },
});

/** The lowest stored value (whole hundredths) at or above `ceiling`. */
function lowestStoredAtOrAbove(ceiling: number): number {
  return Math.ceil(ceiling * HUNDREDTHS - 1e-9) / HUNDREDTHS;
}

/**
 * The change one region gets today: minus its drag, nested under "Production popularity drag in
 * <region>". If the door's rounding to hundredths would land below a ceiling that is not itself a
 * whole hundredth, the loss stops at the lowest stored value above the ceiling.
 */
function regionDragDelta(
  regionName: string,
  popularity: number,
  drag: Traced<number>,
  ceiling: number,
): Traced<number> {
  const calc = startCalc(`Production popularity drag in ${regionName}`, drag, {
    unit: 'points',
    docRef: POPULARITY_DRAG_DOC_REF,
    startLabel: 'Popularity drag',
  }).multiply('Lost', -1, 'The drag comes off the popularity');
  const floor = lowestStoredAtOrAbove(ceiling);
  const stored = Math.round((popularity + calc.current) * HUNDREDTHS) / HUNDREDTHS;
  if (stored < floor) {
    calc
      .max('Kept at the ceiling', floor - popularity)
      .note('Popularity is stored to two decimal places and never drops below the ceiling');
  }
  return calc.done();
}

/** Every day: popularity above an active promotion's ceiling falls towards it. */
export const popularityDragPhase: PhaseDefinition = definePhase({
  id: POPULARITY_DRAG_PHASE_ID,
  group: 'growth',
  // Late in the growth group, after anything that raises popularity during the day.
  order: 90,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    for (const promotion of activePromotions(ctx)) {
      const ceiling = popularityCeiling(
        {
          promotionName: promotion.name,
          marketing: promotion.production.marketing,
          backOffice: promotion.production.backOffice,
        },
        { tunables: ctx.tunables },
      );
      const over = Object.entries(promotion.regionalPop)
        .filter(([, popularity]) => popularity > ceiling.value)
        .map(([regionId]) => regionId as RegionId)
        .sort(compareIds);
      if (over.length === 0) {
        continue;
      }
      const regionDeltas: Partial<Record<RegionId, Traced<number>>> = {};
      for (const regionId of over) {
        const popularity = promotion.regionalPop[regionId] ?? 0;
        const regionName = ctx.read.tables.regions.require(regionId).name;
        const drag = popularityDrag(
          { regionName, popularity, ceiling },
          { tunables: ctx.tunables },
        );
        if (drag.value <= 0) {
          continue;
        }
        const delta = regionDragDelta(regionName, popularity, drag, ceiling.value);
        if (delta.value < 0) {
          regionDeltas[regionId] = delta;
        }
      }
      if (Object.keys(regionDeltas).length === 0) {
        continue;
      }
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: promotion.id },
        regionDeltas,
        source: 'system',
        reason: { key: POPULARITY_DRAG_REASON_KEY, label: POPULARITY_DRAG_REASON_LABEL },
      });
    }
  },
});

export const productionPhases: readonly PhaseDefinition[] = [
  monthlyOverheadPhase,
  popularityDragPhase,
];
