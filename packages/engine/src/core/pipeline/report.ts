/**
 * Day and step reports.
 *
 * Every step the pipeline runs (or skips) gets a {@link StepReport}, and a day returns them all in
 * a {@link DayReport}. Reports are plain JSON, so they cross the Web Worker boundary and can go
 * into a bug report as they are.
 *
 * Everything under `timing` comes from the host's clock and differs from run to run, and an error's
 * `stack` depends on where the code was called from. Leave both out of any determinism comparison
 * (see {@link deterministicDayReport}).
 */

import type { GameDate } from '../date';
import type { SerializedError } from '../errors';
import type { PhaseGroup } from './groups';

/** Wall-clock time a step or day took, from the host's `now()`. Not deterministic. */
export interface StepTiming {
  ms: number;
}

/** A reaction to one of the step's events that threw and was rolled back. */
export interface ReactionFailureReport {
  subscriberId: string;
  /** The `seq` of the event the subscriber was reacting to. */
  eventSeq: number;
  error: SerializedError;
}

export type StepStatus = 'ok' | 'failed' | 'skipped';

/** Why a phase did not run today. */
export type SkippedReason = 'cadence' | 'condition';

export interface StepReport {
  /** The phase id, `pipeline.open` / `pipeline.close`, or the command id. */
  stepId: string;
  /** The phase group, or null for a step that is not part of the day (a command). */
  group: PhaseGroup | null;
  status: StepStatus;
  /** Set when `status` is `skipped`. */
  skippedReason?: SkippedReason;
  /** Set when `status` is `failed`. */
  error?: SerializedError;
  /** Events the step itself committed (0 when it failed). Events from its reactions are not counted. */
  eventsPublished: number;
  /** Distinct traces the step committed (0 when it failed). */
  tracesRecorded: number;
  /** Reactions to the step's events (or to its failure event) that failed. */
  reactionFailures: ReactionFailureReport[];
  /** Lines the step and its reactions wrote with `ctx.log`, plus pipeline notes. */
  logs: string[];
  timing: StepTiming;
}

export interface DayReport {
  /** The date that was simulated. The world is on the next day once the report is returned. */
  date: GameDate;
  steps: StepReport[];
  /** Steps with status `failed`. Reaction failures are listed per step and not counted here. */
  failedCount: number;
  /** Every event committed during the day: steps, reactions and failure notices. */
  eventsPublished: number;
  timing: StepTiming;
}

/** A skipped step's report. */
export function skippedStepReport(
  stepId: string,
  group: PhaseGroup | null,
  reason: SkippedReason,
): StepReport {
  return {
    stepId,
    group,
    status: 'skipped',
    skippedReason: reason,
    eventsPublished: 0,
    tracesRecorded: 0,
    reactionFailures: [],
    logs: [],
    timing: { ms: 0 },
  };
}

/** A step report without its timing or error stacks, for comparing two runs. */
export type DeterministicStepReport = Omit<StepReport, 'timing'>;

/** A day report without any timing or error stacks, for comparing two runs. */
export type DeterministicDayReport = Omit<DayReport, 'timing' | 'steps'> & {
  steps: DeterministicStepReport[];
};

/** An error without its stack. */
function withoutStack(error: SerializedError): SerializedError {
  return {
    name: error.name,
    message: error.message,
    ...(error.code === undefined ? {} : { code: error.code }),
  };
}

/** A step report without its timing or error stacks. */
function deterministicStepReport(step: StepReport): DeterministicStepReport {
  return {
    stepId: step.stepId,
    group: step.group,
    status: step.status,
    ...(step.skippedReason === undefined ? {} : { skippedReason: step.skippedReason }),
    ...(step.error === undefined ? {} : { error: withoutStack(step.error) }),
    eventsPublished: step.eventsPublished,
    tracesRecorded: step.tracesRecorded,
    reactionFailures: step.reactionFailures.map((failure) => ({
      subscriberId: failure.subscriberId,
      eventSeq: failure.eventSeq,
      error: withoutStack(failure.error),
    })),
    logs: step.logs,
  };
}

/**
 * A day report with every timing and every error stack removed: what two runs from the same world
 * and seed must agree on exactly.
 */
export function deterministicDayReport(report: DayReport): DeterministicDayReport {
  return {
    date: report.date,
    steps: report.steps.map(deterministicStepReport),
    failedCount: report.failedCount,
    eventsPublished: report.eventsPublished,
  };
}
