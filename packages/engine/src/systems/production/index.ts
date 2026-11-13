/**
 * The production system (ECO7): the eight production areas a promotion pays for, what each level
 * costs to run and to buy, and how far marketing and back office let popularity grow.
 *
 * ECO7-01 lays the groundwork: the area tables (`areas.ts`), the tunables (`tunables.ts`) and the
 * pure traced formulas (`formulas/`). Nothing charges money or appears on screen yet: the queries,
 * commands and phases arrive in ECO7-02 and ECO7-03. Production never rolls, so there is no RNG
 * stream. EVT4 owns the show-quality ceiling (system `cardFlow`). See docs/design/production.md.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';

export {
  AREA_COST_KIND,
  AREA_LABELS,
  AREA_LEDGER_CATEGORY,
  MONTHLY_AREAS,
  PER_SHOW_AREAS,
  PRODUCTION_LEDGER_CATEGORIES,
  type AreaCostKind,
  type ProductionLedgerCategory,
} from './areas';
export { PRODUCTION_TUNABLE_CATEGORY, productionTunables } from './tunables';
export {
  AREA_COSTS_DOC_REF,
  costCurveAt,
  moneyText,
  PER_SHOW_COSTS_DOC_REF,
  POPULARITY_CEILING_DOC_REF,
  POPULARITY_DRAG_DOC_REF,
  UPGRADE_FEE_DOC_REF,
  UPGRADE_FEE_KEYS,
} from './formulas/shared';
export {
  AREA_PRICE_KEYS,
  areaCost,
  IMPORTANCE_SHOW_LABELS,
  MONTHLY_IGNORES_IMPORTANCE,
  SHOW_COST_MULTIPLIER_KEYS,
  type AreaCostInputs,
} from './formulas/areaCost';
export {
  areaLineLabel,
  PRODUCTION_CATEGORY_LABELS,
  productionMonthlyCost,
  type ProductionMonthlyCost,
  type ProductionMonthlyCostInputs,
} from './formulas/productionMonthlyCost';
export {
  NO_PAID_PRODUCTION_NOTE,
  NO_SHOWS_IN_WINDOW_NOTE,
  productionShowCost,
  upcomingShowCost,
  upcomingShowLabel,
  type ProductionShowCostInputs,
  type UpcomingShow,
  type UpcomingShowCostInputs,
} from './formulas/productionShowCost';
export { LOWERING_IS_FREE, upgradeFee, type UpgradeFeeInputs } from './formulas/upgradeFee';
export { popularityCeiling, type PopularityCeilingInputs } from './formulas/popularityCeiling';
export {
  popularityDrag,
  UNDER_CEILING_NO_DRAG,
  type PopularityDragInputs,
} from './formulas/popularityDrag';

export const productionSystem: SystemBundle = defineSystem({ id: 'production' });
