/**
 * The health system: daily fatigue recovery and weekly, age-capped body-condition recovery.
 *
 * This is the reference system. It touches every part of the core once: tunables
 * (`tunables.ts`), a named RNG stream (`streams.ts`), pure traced formulas (`formulas/`), a daily
 * and a weekly phase writing through their transaction (`phases.ts`), a domain event
 * (`events.ts`), a stored trace, and a query that returns a "Why?"-ready view (`queries.ts`). New
 * systems copy its layout. See docs/design/health.md and
 * docs/design/calculation-traces.md#worked-example.
 *
 * WRK6 builds on it: injuries and returns (WRK6-03, `injure.ts`, `returns.ts`), off-screen injuries
 * and the own-injury gate (WRK6-04, `offscreen.ts`, `notice.ts`, `gate.ts`, `commands.ts`)
 * and the health profile query, `health.profile` (WRK6-05).
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
// Registers `health.injure` as MTCH4's injury handler.
import './injuryHandler';
import './policyEffects';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { healthCommands } from './commands';
import { ownWorkerInjuredGate } from './gate';
import { healthPhases } from './phases';
import { healthQueries } from './queries';

export {
  computeFatigueRecovery,
  FATIGUE_MAX,
  FATIGUE_MIN,
  type FatigueRecoveryInputs,
} from './formulas/fatigueRecovery';
export {
  computeConditionCap,
  CONDITION_MAX,
  CONDITION_MIN,
  type ConditionCapInputs,
} from './formulas/conditionCap';
export {
  AT_CAP_BRANCH,
  computeConditionRecovery,
  INJURED_PART_BRANCH,
  medicalCareLabel,
  type ConditionRecoveryInputs,
} from './formulas/conditionRecovery';
export { medicalLevelOf, type MedicalCare, type MedicalLevel } from './medical';
export { restFollowsShowsOn, talkedWithoutWrestling } from './appearances';
export {
  conditionRecoveryPhase,
  FATIGUE_RECOVERY_TRACE_KIND,
  fatigueRecoveryPhase,
  fatigueRecoveryTraceRef,
} from './phases';
export { INJURIES_STREAM, OFFSCREEN_STREAM, RECOVERY_STREAM } from './streams';
export {
  computeOffscreenInjuryChance,
  DAYS_IN_A_YEAR,
  NO_RIVAL_RULE_NOTE,
  OFFSCREEN_INJURY_DOC_REF,
  OFFSCREEN_NEITHER_TRAIT_BRANCH,
  offscreenInjuryChanceValue,
  RIVAL_RULE_BRANCH,
  RIVAL_RULE_OFF_BRANCH,
  worstPartLabel,
  type OffscreenInjuryChanceInputs,
} from './formulas/offscreenInjuryChance';
export {
  isOffscreenEligible,
  OFFSCREEN_INJURIES_PHASE_ID,
  offscreenInjuriesPhase,
  rollOffscreenInjuries,
} from './offscreen';
export { offscreenShortcutOf } from './rivalShortcut';
export { employerControllersOf, needsNotice, worksFor, worksForAHuman } from './notice';
export {
  injuriesAwaitingNotice,
  OWN_WORKER_INJURED_GATE_ID,
  ownInjuryReason,
  ownWorkerInjuredGate,
  plainDate,
  ringNameOn,
  ROSTER_ACTION_HINT,
} from './gate';
export {
  ACKNOWLEDGE_MAX_INJURIES,
  ACKNOWLEDGE_REASON_CODES,
  acknowledgeInjuriesCommand,
  healthCommands,
  type AcknowledgeReasonCode,
} from './commands';
export {
  anglesNote,
  injure,
  INJURY_CHANCE_TRACE_KIND,
  INJURY_CONDITION_LOSS_TRACE_KIND,
  INJURY_TRACE_KIND,
  INJURY_TRACE_KINDS,
  injuryConditionLossTraceRef,
  injuryRecordChanceTraceRef,
  injuryTraceRef,
  type InjureOptions,
  type InjureRefusal,
  type InjureResult,
} from './injure';
export { HEALTH_INJURY_HANDLER_ID, healthInjuryHandler } from './injuryHandler';
export {
  CONDITION_RECOVERY_CADENCE,
  MORNING_BEFORE_SHOW_HOOK_ID,
  morningBeforeShowHook,
  morningRanEarly,
  recoverConditions,
  runFatigueMorning,
} from './morning';
export { MEDICAL_POLICY_EFFECT_ID, medicalPolicyEffect, medicalPolicyLines } from './policyEffects';
export {
  healInjuries,
  PRUNE_INJURY_DETAIL_PHASE_ID,
  pruneInjuryDetail,
  pruneInjuryDetailPhase,
} from './returns';
export {
  decideInjurySeverity,
  INJURY_DOC_REF,
  SEVERITY_SET_BY_MATCH,
  severityLabel,
  type InjurySeverityInputs,
} from './formulas/injurySeverity';
export {
  AT_LEAST_A_DAY,
  catalogRangeLabel,
  computeInjuryDays,
  NEITHER_TRAIT_BRANCH,
  type InjuryDaysInputs,
} from './formulas/injuryOutcome';
export {
  computeInjuryConditionLoss,
  type InjuryConditionLossInputs,
} from './formulas/injuryConditionLoss';
export {
  NO_INJURY_KINDS,
  pickInjuryKind,
  type InjuryKindPickInputs,
} from './formulas/injuryKindPick';
export { HEALTH_TUNABLE_CATEGORY, healthTunables } from './tunables';
export {
  FATIGUE_BANDS,
  fatigueBandOf,
  HEALTH_PROFILE_HISTORY_LIMIT,
  healthProfileQuery,
  healthReportQuery,
  type BodyPartHealth,
  type FatigueBand,
  type HealthProfile,
  type HealthReport,
  type HealthReportArgs,
  type InjuredRow,
  type InjuryView,
} from './queries';

export const healthSystem: SystemBundle = defineSystem({
  id: 'health',
  phases: healthPhases,
  queries: healthQueries,
  gates: [ownWorkerInjuredGate],
  commands: healthCommands,
});
