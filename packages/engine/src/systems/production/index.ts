/**
 * The production system (ECO7): the eight production areas a promotion pays for, what each level
 * costs to run and to buy, and how far marketing and back office let popularity grow.
 *
 * ECO7-01 lays the groundwork: the area tables (`areas.ts`), the tunables (`tunables.ts`) and the
 * pure traced formulas (`formulas/`). ECO7-02 adds the read and write sides: the change check and
 * write door (`door.ts`), the `production.setLevel` command, the `production.overview` and
 * `production.changePreview` queries and the effect seam (`effects.ts`). ECO7-03 adds the day
 * phases (`phases.ts`): the monthly overhead on the 1st and the daily popularity drag above the
 * ceiling. The per-show postings arrive in ECO7-05. Production never rolls, so there is no RNG
 * stream. EVT4 owns the show-quality ceiling (system `cardFlow`). See docs/design/production.md.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import './events';
import './builtinEffects';
import { setProductionLevelCommand } from './commands';
import { productionPhases } from './phases';
import { productionChangePreviewQuery, productionOverviewQuery } from './queries';

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

export type { ProductionChangeSource } from './events';
export { activeBroadcastDeal, dealRunsOn } from './deals';
export { upcomingShows, type ProductionUpcomingShow } from './upcoming';
export {
  CHANGE_LEVEL_DOC_REF,
  changeProductionLevel,
  checkLevelChange,
  PRODUCTION_CHANGE_REASON_CODES,
  type ChangeProductionLevelArgs,
  type LevelChangeCheck,
  type LevelChangeRequest,
  type ProductionChangeReasonCode,
} from './door';
export {
  clearProductionEffectsForTests,
  listProductionEffects,
  registerProductionEffect,
  type ProductionEffect,
  type ProductionEffectInput,
  type ProductionEffectLine,
} from './effects';
export { POPULARITY_CEILING_EFFECT_ID, TV_CAMERA_MINIMUM_EFFECT_ID } from './builtinEffects';
export {
  NOT_YOUR_PROMOTION_MESSAGE,
  productionCommands,
  setProductionLevelCommand,
  type SetProductionLevelArgs,
  type SetProductionLevelResult,
} from './commands';
export {
  productionChangePreviewQuery,
  productionOverviewQuery,
  productionQueries,
  type ProductionChangePreview,
  type ProductionChangePreviewArgs,
  type ProductionOverview,
  type ProductionPreviewRow,
  type ProductionPreviewRowId,
  type ProductionRow,
} from './queries';

export {
  MONTHLY_OVERHEAD_PHASE_ID,
  MONTHLY_OVERHEAD_TRACE_KIND,
  monthlyOverheadPhase,
  monthlyOverheadTraceRef,
  POPULARITY_DRAG_PHASE_ID,
  POPULARITY_DRAG_REASON_KEY,
  POPULARITY_DRAG_REASON_LABEL,
  popularityDragPhase,
  productionPhases,
} from './phases';

export const productionSystem: SystemBundle = defineSystem({
  id: 'production',
  phases: productionPhases,
  queries: [productionOverviewQuery, productionChangePreviewQuery],
  commands: [setProductionLevelCommand],
});
