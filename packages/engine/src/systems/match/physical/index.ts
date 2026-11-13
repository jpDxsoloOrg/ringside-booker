/**
 * The physical toll (MTCH4): what a match costs a worker's body. MTCH4-01 adds the inputs, the risk
 * modifier seam, the tunables and the wear stream; the formulas live in `../formulas/`
 * (`fatigueGain.ts`, `conditionWear.ts`, `wearByPart.ts`). Later MTCH4 tickets add the injury
 * chance, the show-night applier and the queries to the match system.
 *
 * Design: docs/design/physical-toll.md.
 */

import './streams';

export { physicalTunables } from './tunables';
export { WEAR_STREAM } from './streams';
export {
  collectPhysicalInputs,
  earlierMatchesOnCard,
  loadCarriersBySide,
  type PhysicalCardPosition,
  type PhysicalOpponent,
  type PhysicalParticipant,
  type PhysicalSegmentSpec,
  type PhysicalWorkerInputs,
} from './inputs';
export {
  MAX_RISK_MODIFIER_ORDER,
  collectRiskContributions,
  registerRiskModifier,
  riskModifierIds,
  type AppliedRiskContribution,
  type RiskContext,
  type RiskContribution,
  type RiskModifierSpec,
} from './riskModifiers';
export {
  FATIGUE_GAIN_DOC_REF,
  applyRepeatMatch,
  computeFatigueGain,
  keepItSafeSource,
  repeatMatchFactor,
  repeatMatchLabel,
  type FatigueGainInputs,
} from '../formulas/fatigueGain';
export {
  CONDITION_WEAR_DOC_REF,
  ROUGHNESS_ROLL_LABEL,
  computeConditionWear,
  roughestOpponentOf,
  type ConditionWearInputs,
} from '../formulas/conditionWear';
export { computeWearByPart } from '../formulas/wearByPart';
