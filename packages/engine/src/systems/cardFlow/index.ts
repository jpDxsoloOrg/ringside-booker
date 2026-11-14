/**
 * Card flow (EVT4): what shapes a show's card and score beyond its segments.
 *
 * EVT4-02 adds the production rules: the production ceiling, a `cap` show score modifier that
 * holds every show of every promotion to the score its stage, camera, editing and pyro allow
 * (`result.rawScore` keeps what the card earned), and the bonus slot, one extra main-card slot for
 * the regular-or-bigger shows of a promotion whose ceiling reaches the threshold. Both read
 * `promotions.production`; ECO7 changes the levels. Design: docs/design/card-flow.md.
 *
 * EVT4-01's card flow scaffold lives here too; whichever of the two lands second merges into this
 * bundle.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import { refreshBonusSlotsPhase } from './bonusSlots';
import './ceiling';
import './productionEffect';
import { cardFlowQueries } from './queries';

export {
  BONUS_SLOT_ADJUSTER_ID,
  refreshBonusSlotsPhase,
  unregisterBonusSlotAdjuster,
} from './bonusSlots';
export {
  PRODUCTION_CEILING_MODIFIER_ID,
  PRODUCTION_CEILING_STEP_LABELS,
  applyProductionCeiling,
  productionCeilingModifier,
} from './ceiling';
export {
  BONUS_SLOT_DOC_REF,
  SHOW_SLOTS_MAX_REASON,
  bonusSlotCount,
  bonusSlotFor,
  bonusSlotProductionCheck,
  importanceAtLeast,
  qualifiesForBonusSlot,
  type BonusSlotInputs,
  type BonusSlotOutcome,
  type BonusSlotResult,
} from './formulas/bonusSlot';
export {
  CEILING_AREAS,
  PRODUCTION_CEILING_DOC_REF,
  PRODUCTION_CEILING_LABELS,
  PRODUCTION_CEILING_MAX,
  PRODUCTION_CEILING_MIN,
  ceilingLevelsOf,
  productionCeiling,
  productionCeilingOf,
  productionCeilingValue,
  type CeilingArea,
  type CeilingLevels,
  type ProductionCeilingInputs,
} from './formulas/productionCeiling';
export {
  PRODUCTION_CEILING_UNKNOWN_PROMOTION_MESSAGE,
  cardFlowQueries,
  productionCeilingQuery,
  type ProductionCeilingView,
} from './queries';
export { BONUS_SLOT_TRACE_KIND, bonusSlotTraceRef } from './traces';
export {
  SHOW_CEILING_EFFECT_ID,
  SHOW_CEILING_EFFECT_LABEL,
  showCeilingText,
  unregisterShowCeilingEffect,
} from './productionEffect';
export { cardFlowTunables } from './tunables';

export const cardFlowSystem: SystemBundle = defineSystem({
  id: 'cardFlow',
  phases: [refreshBonusSlotsPhase],
  queries: cardFlowQueries,
});
