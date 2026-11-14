/**
 * TEMPORARY: the rival production budget (ECO7-05), a stopgap until AIP8's rival production desk.
 *
 * Without it, computer-run promotions keep the production levels the world started them with,
 * whatever they cost, and the monthly overhead (ECO7-03) plus the per-show costs (ECO7-05) push
 * the small ones into debt within a year. On the 1st of each month, before the overhead is
 * charged, each active computer-run promotion compares its cash with what its production costs a
 * month (the overhead plus the per-show cost of its shows in the next `production.forecastDays`):
 *
 * - **Too little cash** (less than `production.rivalBudget.lowerBelowMonths` months of it): it
 *   lowers levels one step at a time, cheapest harm first, until the cash covers that many months
 *   or nothing more can be lowered. Music and writing have no effect yet, so they go first; a
 *   show-quality area (stage, camera, editing, pyro) hurts only where the show-quality ceiling
 *   would drop below the best show it ran lately plus `production.rivalBudget.headroom`; marketing
 *   and back office hurt only where the popularity ceiling would drop below its best region plus
 *   the same headroom. Among harmless steps the biggest saving goes first; otherwise the least
 *   harm per dollar saved.
 * - **Plenty of cash** (at least `production.rivalBudget.raiseAboveMonths` months of the cost
 *   after the change, plus the upgrade fee): it raises one level a month, and only where a ceiling
 *   is holding it back (its best recent show or best region is within the headroom of the
 *   ceiling), the most relief per dollar first. Music and writing are never raised.
 *
 * Every change goes through `changeProductionLevel` with source `'ai'`, so rivals pay the same
 * fees by the same rules as the player (D-01) and the TV-deal camera minimum holds. The player's
 * promotions are never touched. The rule is a decision, not one of the Rival rules shortcuts, so
 * the Level playing field setting does not turn it off. Either months tunable at 0 turns that half
 * off. AIP8 replaces this file: delete it and its tunables when the business review sets levels.
 *
 * Design: docs/design/production.md#rival-production-budget.
 */

import { addDays, isBefore } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { EventImportance } from '../../model/entities/event-definition';
import {
  PRODUCTION_AREAS,
  PRODUCTION_LEVEL_MAX,
  PRODUCTION_LEVEL_MIN,
  type Production,
  type ProductionArea,
} from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import { productionCeilingValue } from '../cardFlow/formulas/productionCeiling';
import type { EngineTunables } from '../tunables';
import { AREA_COST_KIND, AREA_LABELS } from './areas';
import { checkLevelChange, changeProductionLevel } from './door';
import { areaCost } from './formulas/areaCost';
import { popularityCeiling } from './formulas/popularityCeiling';
import { upcomingShows } from './upcoming';

export const RIVAL_BUDGET_PHASE_ID = 'production.rivalBudget';

/** Areas the budget may lower but never raises: nothing reads them yet. */
const NO_EFFECT_YET: ReadonlySet<ProductionArea> = new Set(['music', 'writing']);
const SHOW_QUALITY_AREAS: ReadonlySet<ProductionArea> = new Set([
  'stage',
  'camera',
  'editing',
  'pyro',
]);
const POPULARITY_AREAS: ReadonlySet<ProductionArea> = new Set(['marketing', 'backOffice']);

/** What one promotion's production is worth to it right now: its best recent show and region. */
interface BudgetNeeds {
  /** The best raw score of a show it completed lately (0 when none). */
  readonly bestShow: number;
  /** Its highest regional popularity (0 when none). */
  readonly bestRegion: number;
  /** The importance of each show it expects to run in the forecast window. */
  readonly shows: readonly EventImportance[];
}

/** One possible one-step change and what it does. */
interface BudgetStep {
  readonly area: ProductionArea;
  readonly to: number;
  /** Cents a month the change saves (lowering) or adds (raising), always ≥ 0. */
  readonly money: number;
  /** Points of ceiling shortfall the change adds (lowering) or removes (raising), ≥ 0. */
  readonly harm: number;
}

/** A month of one promotion's production at `levels`, in cents. Memoised per area and level. */
class MonthlyCost {
  readonly #cache = new Map<string, number>();

  constructor(
    private readonly shows: readonly EventImportance[],
    private readonly tunables: EngineTunables,
  ) {}

  area(area: ProductionArea, level: number): number {
    const key = `${area}:${String(level)}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const deps = { tunables: this.tunables };
    let value = 0;
    if (AREA_COST_KIND[area] === 'monthly') {
      value = areaCost({ area, level, importance: null }, deps).value;
    } else {
      for (const importance of this.shows) {
        value += areaCost({ area, level, importance }, deps).value;
      }
    }
    this.#cache.set(key, value);
    return value;
  }

  total(levels: Production): number {
    let sum = 0;
    for (const area of PRODUCTION_AREAS) {
      sum += this.area(area, levels[area]);
    }
    return sum;
  }
}

function needsOf(
  read: GameWorldView,
  promotionId: PromotionId,
  regionalPop: Readonly<Record<string, number>>,
  ctx: Pick<PhaseContext, 'date' | 'tunables'>,
): BudgetNeeds {
  const since = addDays(ctx.date, -ctx.tunables.get('production.rivalBudget.lookbackDays'));
  let bestShow = 0;
  for (const show of read.tables.eventInstances.lookup('byPromotion', promotionId)) {
    if (show.status === 'completed' && show.result !== null && !isBefore(show.date, since)) {
      bestShow = Math.max(bestShow, show.result.rawScore);
    }
  }
  const bestRegion = Math.max(0, ...Object.values(regionalPop));
  const shows = upcomingShows(
    read,
    promotionId,
    ctx.date,
    ctx.tunables.get('production.forecastDays'),
  ).map((show) => show.importance);
  return { bestShow, bestRegion, shows };
}

/**
 * How many points the promotion's ceilings fall short of what it reaches plus the headroom, at
 * `levels`: the show-quality shortfall for the four show areas, the popularity shortfall for
 * marketing and back office, 0 for music and writing.
 */
function shortfall(
  area: ProductionArea,
  levels: Production,
  needs: BudgetNeeds,
  promotionName: string,
  tunables: EngineTunables,
): number {
  const headroom = tunables.get('production.rivalBudget.headroom');
  if (SHOW_QUALITY_AREAS.has(area)) {
    return Math.max(0, needs.bestShow + headroom - productionCeilingValue(levels, tunables));
  }
  if (POPULARITY_AREAS.has(area)) {
    const ceiling = popularityCeiling(
      { promotionName, marketing: levels.marketing, backOffice: levels.backOffice },
      { tunables },
    ).value;
    return Math.max(0, needs.bestRegion + headroom - ceiling);
  }
  return 0;
}

function withLevel(levels: Production, area: ProductionArea, level: number): Production {
  return { ...levels, [area]: level };
}

/** True when the door would accept the change (TV-deal camera minimum, cash for the fee, ...). */
function allowed(
  ctx: PhaseContext,
  promotionId: PromotionId,
  area: ProductionArea,
  level: number,
): boolean {
  return (
    checkLevelChange(ctx.read, { promotionId, area, level }, ctx.tunables, ctx.date).reasons
      .length === 0
  );
}

/** The one-step cut that hurts least for what it saves, or null when nothing can be lowered. */
function bestCut(
  ctx: PhaseContext,
  promotionId: PromotionId,
  promotionName: string,
  levels: Production,
  needs: BudgetNeeds,
  cost: MonthlyCost,
): BudgetStep | null {
  let best: BudgetStep | null = null;
  for (const area of PRODUCTION_AREAS) {
    const from = levels[area];
    const to = from - 1;
    if (to < PRODUCTION_LEVEL_MIN) {
      continue;
    }
    const money = cost.area(area, from) - cost.area(area, to);
    if (money <= 0 || !allowed(ctx, promotionId, area, to)) {
      continue;
    }
    const after = withLevel(levels, area, to);
    const harm =
      shortfall(area, after, needs, promotionName, ctx.tunables) -
      shortfall(area, levels, needs, promotionName, ctx.tunables);
    const step = { area, to, money, harm };
    if (best === null || cutIsBetter(step, best)) {
      best = step;
    }
  }
  return best;
}

/** Harmless cuts first, biggest saving first; then the least harm per dollar saved. */
function cutIsBetter(step: BudgetStep, than: BudgetStep): boolean {
  if (step.harm === 0 || than.harm === 0) {
    if (step.harm === 0 && than.harm === 0) {
      return step.money > than.money;
    }
    return step.harm === 0;
  }
  return step.harm / step.money < than.harm / than.money;
}

/** The one-step raise that relieves a ceiling most per dollar, or null when none helps. */
function bestRaise(
  ctx: PhaseContext,
  promotionId: PromotionId,
  promotionName: string,
  cash: number,
  levels: Production,
  needs: BudgetNeeds,
  cost: MonthlyCost,
): BudgetStep | null {
  const months = ctx.tunables.get('production.rivalBudget.raiseAboveMonths');
  let best: BudgetStep | null = null;
  let bestScore = 0;
  for (const area of PRODUCTION_AREAS) {
    const from = levels[area];
    const to = from + 1;
    if (NO_EFFECT_YET.has(area) || to > PRODUCTION_LEVEL_MAX) {
      continue;
    }
    const after = withLevel(levels, area, to);
    const relief =
      shortfall(area, levels, needs, promotionName, ctx.tunables) -
      shortfall(area, after, needs, promotionName, ctx.tunables);
    if (relief <= 0) {
      continue;
    }
    const check = checkLevelChange(
      ctx.read,
      { promotionId, area, level: to },
      ctx.tunables,
      ctx.date,
    );
    const fee = check.fee.value;
    if (check.reasons.length > 0 || cash - fee < months * cost.total(after)) {
      continue;
    }
    const money = cost.area(area, to) - cost.area(area, from);
    // Relief per dollar of the first year: the fee plus twelve months of the higher running cost.
    const score = relief / Math.max(1, fee + 12 * money);
    if (best === null || score > bestScore) {
      best = { area, to, money, harm: relief };
      bestScore = score;
    }
  }
  return best;
}

/** On the 1st: every computer-run promotion fits its production to its cash. */
export const rivalBudgetPhase: PhaseDefinition = definePhase({
  id: RIVAL_BUDGET_PHASE_ID,
  group: 'money',
  // Before the monthly overhead (35), so a cut lowers this month's overhead.
  order: 33,
  cadence: { kind: 'monthly', day: 1 },
  run: (ctx) => {
    const lowerBelow = ctx.tunables.get('production.rivalBudget.lowerBelowMonths');
    const raiseAbove = ctx.tunables.get('production.rivalBudget.raiseAboveMonths');
    if (lowerBelow === 0 && raiseAbove === 0) {
      return;
    }
    const rivals = ctx.read.tables.promotions
      .values()
      .filter(
        (promotion) => promotion.status === 'active' && promotion.controller.kind === 'computer',
      );
    for (const promotion of rivals) {
      const needs = needsOf(ctx.read, promotion.id, promotion.regionalPop, ctx);
      const cost = new MonthlyCost(needs.shows, ctx.tunables);
      let levels: Production = { ...promotion.production };
      const cash = promotion.cash;
      let changed = false;
      while (lowerBelow > 0 && cash < lowerBelow * cost.total(levels)) {
        const cut = bestCut(ctx, promotion.id, promotion.name, levels, needs, cost);
        if (cut === null) {
          break;
        }
        changeProductionLevel(ctx, {
          promotionId: promotion.id,
          area: cut.area,
          level: cut.to,
          source: 'ai',
        });
        ctx.log(`${promotion.name}: ${AREA_LABELS[cut.area]} lowered to ${String(cut.to)}`);
        levels = withLevel(levels, cut.area, cut.to);
        changed = true;
      }
      if (changed || raiseAbove === 0) {
        continue;
      }
      const raise = bestRaise(ctx, promotion.id, promotion.name, cash, levels, needs, cost);
      if (raise !== null) {
        changeProductionLevel(ctx, {
          promotionId: promotion.id,
          area: raise.area,
          level: raise.to,
          source: 'ai',
        });
        ctx.log(`${promotion.name}: ${AREA_LABELS[raise.area]} raised to ${String(raise.to)}`);
      }
    }
  },
});
