/** Public surface of the day pipeline. See `docs/design/day-pipeline.md`. */

export type { PhaseContext, ReactionContext, StepContext } from './context';
export {
  ENGINE_ONLY_GROUPS,
  isEngineOnlyGroup,
  isPhaseGroup,
  MAX_PHASE_ORDER,
  PHASE_GROUP_BASES,
  PHASE_GROUPS,
  phasePosition,
  type PhaseGroup,
  type SystemPhaseGroup,
} from './groups';
export { definePhase, PHASE_ID_PATTERN, type PhaseDefinition, type PhaseSpec } from './phase';
export { PhaseRegistry, RESERVED_PHASE_SYSTEM } from './registry';
export {
  skippedStepReport,
  deterministicDayReport,
  type DayReport,
  type DeterministicDayReport,
  type ReactionFailureReport,
  type SkippedReason,
  type StepReport,
  type DeterministicStepReport,
  type StepStatus,
  type StepTiming,
} from './report';
export {
  parsePipelineFailureLogState,
  PIPELINE_FAILURE_LOG_CAPACITY,
  PipelineFailureLog,
  pipelineFailureLogStateSchema,
  type PipelineFailure,
  type PipelineFailureLogState,
} from './failureLog';
export { createRuntime, type CreateRuntimeOptions, type SimHost, type SimRuntime } from './runtime';
export {
  reactionStepId,
  reportStepFailure,
  runStep,
  type RunStepOptions,
  type StepFailure,
} from './runStep';
export { CLOSE_STEP_ID, OPEN_STEP_ID, runDay } from './runDay';
export {
  defineGate,
  evaluateGates,
  GATE_ID_PATTERN,
  GateRegistry,
  RESERVED_GATE_SYSTEM,
  type GateDefinition,
  type GateHit,
  type GateSpec,
} from './gates';
export {
  advanceDays,
  MAX_ADVANCE_DAYS,
  REPEATED_FAILURE_GATE_ID,
  STOP_DATE_GATE_ID,
  type AdvanceFailure,
  type AdvanceOptions,
  type AdvanceProgress,
  type AdvanceResult,
  type AdvanceStop,
  type CancelSignal,
} from './advance';
