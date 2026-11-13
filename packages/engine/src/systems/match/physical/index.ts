/**
 * The physical toll (MTCH4): what a match costs a worker's body. MTCH4-01 adds the inputs, the risk
 * modifier seam, the tunables and the wear stream; the formulas live in `../formulas/`
 * (`fatigueGain.ts`, `conditionWear.ts`, `wearByPart.ts`). MTCH4-02 adds the injury chance
 * (`../formulas/injuryChance.ts`), the injury roll and handler seam (`injuries.ts`) and the trace
 * refs (`traceRefs.ts`). Later MTCH4 tickets add the show-night applier and the queries.
 *
 * Design: docs/design/physical-toll.md.
 */

import './streams';

export { physicalTunables } from './tunables';
export { INJURY_STREAM, WEAR_STREAM } from './streams';
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
  type RepeatMatchKey,
} from '../formulas/fatigueGain';
export {
  CONDITION_WEAR_DOC_REF,
  ROUGHNESS_ROLL_LABEL,
  computeConditionWear,
  roughestOpponentOf,
  type ConditionWearInputs,
} from '../formulas/conditionWear';
export { computeWearByPart } from '../formulas/wearByPart';
export {
  END_FATIGUE_LABEL,
  INJURIES_OFF_LABEL,
  INJURY_CHANCE_DOC_REF,
  RIVAL_NO_INJURIES_LABEL,
  computeInjuryChance,
  conditionAfterWear,
  leastSafeOpponentOf,
  riskiestOpponentOf,
  worstBodyPart,
  type InjuryChanceInputs,
} from '../formulas/injuryChance';
export {
  INJURY_DECISION_LABEL,
  INJURY_ROLL_DOC_REF,
  getInjuryHandler,
  injuryLimitLine,
  injuryPolicyFor,
  registerInjuryHandler,
  rollSegmentInjuries,
  type InjuryHandler,
  type InjuryOutcome,
  type InjuryRequest,
  type InjuryRollEntry,
  type InjuryRollResult,
} from './injuries';
export {
  FATIGUE_TRACE_KIND,
  INJURY_CHANCE_TRACE_KIND,
  INJURY_ROLL_TRACE_KIND,
  LEARNING_TRACE_KIND,
  WEAR_TRACE_KIND,
  fatigueTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
  learningTraceRef,
  wearTraceRef,
} from './traceRefs';

// Ring learning (MTCH4-03). `learningRoom` (the hidden gate) stays inside the match system.
export { learningTunables } from './learningTunables';
export {
  IN_MATCH_LEARNING,
  PRODUCED_ATTRIBUTES,
  isTaughtAttribute,
  type InMatchLearningAttribute,
  type InMatchLearningEntry,
} from './learning';
export { mentorOnCard, type MentorOnCard } from './mentor';
export { collectRingLearning, type WorkerRingLearning } from './collectLearning';
export {
  LIMITED_BY_POTENTIAL_LABEL,
  RING_LEARNING_DOC_REF,
  computeRingLearning,
  computeRingLearningTotal,
  type LearningPeer,
  type LearningProducer,
  type RingLearningInputs,
} from '../formulas/ringLearning';
