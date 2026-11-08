/**
 * Multi-day advance: run the day pipeline in a loop until the days run out, a gate stops it, or
 * the host cancels it.
 *
 * Before every day, including the first, {@link evaluateGates} runs the registered gates plus the
 * advance's own two (the stop date and repeated failures). Any hit stops the loop before that day
 * is simulated, so the player books a show before its day runs. After every day the loop reports
 * progress, then awaits the host's `yieldToHost`, so a Web Worker can take a Cancel message between
 * days, and then checks the cancel signal. Days themselves stay synchronous: a cancel always lands
 * between two whole days, never inside one.
 *
 * See the "Gates" and "Multi-day advance" sections of docs/design/day-pipeline.md.
 */

import type { TableRegistry } from '../../model/table-def';
import { isAfter, isGameDate, type GameDate } from '../date';
import { describeValue } from '../errors';
import { evaluateGates, GateRegistry, type GateHit, type GateSpec } from './gates';
import type { DayReport } from './report';
import { runDay } from './runDay';
import type { SimRuntime } from './runtime';

/** The longest skip one call may ask for: ten years. Longer runs call `advanceDays` again. */
export const MAX_ADVANCE_DAYS = 3650;

/** The built-in gate that stops a skip at the start of the date the player asked for. */
export const STOP_DATE_GATE_ID = 'sim.stopDate';

/** The built-in gate that stops a skip when the same step keeps failing. */
export const REPEATED_FAILURE_GATE_ID = 'sim.repeatedFailure';

/**
 * Anything with an `aborted` flag. A host's `AbortSignal` fits, but the engine never names that
 * type, because it is built without the DOM or Node type libraries.
 */
export interface CancelSignal {
  readonly aborted: boolean;
}

/** Progress after one simulated day. */
export interface AdvanceProgress {
  /** Which day of this advance just finished, counting from 1. */
  dayIndex: number;
  /** The date that was simulated. */
  date: GameDate;
  /** The most days this advance will run (`maxDays`). It can stop sooner. */
  totalDays: number;
  /** How many steps failed on that day. */
  failedCount: number;
}

/** What `advanceDays` accepts. */
export interface AdvanceOptions {
  /** The most days to simulate: a whole number from 1 to {@link MAX_ADVANCE_DAYS}. */
  readonly maxDays: number;
  /** Stop at the start of this date, before simulating it. Must be after the current date. */
  readonly stopAtDate?: GameDate;
  /** Checked after every day; once `aborted` is true the advance stops. */
  readonly signal?: CancelSignal;
  /** Awaited once after every day, so the host can handle messages. Defaults to a resolved promise. */
  readonly yieldToHost?: () => Promise<void>;
  /** Called after every day, before the yield. */
  readonly onDay?: (progress: AdvanceProgress) => void;
}

/** Why an advance stopped. */
export type AdvanceStop =
  { kind: 'completed' } | { kind: 'gate'; hits: GateHit[] } | { kind: 'cancelled' };

/** A step that failed during the advance. */
export interface AdvanceFailure {
  date: GameDate;
  stepId: string;
  message: string;
}

/** The outcome of an advance. Plain JSON. */
export interface AdvanceResult {
  /** The world date before the advance. */
  startDate: GameDate;
  /** The world date after it: the first day not simulated. */
  endDate: GameDate;
  daysAdvanced: number;
  stoppedBy: AdvanceStop;
  /** Every failed step, in the order they failed. Reaction failures are on the day reports. */
  failures: AdvanceFailure[];
  /** Every event committed during the advance. */
  eventsPublished: number;
  /** Wall-clock time by the host's clock. Not deterministic. */
  timing: { ms: number };
}

function defaultYieldToHost(): Promise<void> {
  return Promise.resolve();
}

/** Throws `RangeError` for options the loop cannot run with. */
function validateOptions(options: AdvanceOptions, currentDate: GameDate): void {
  const { maxDays, stopAtDate } = options;
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > MAX_ADVANCE_DAYS) {
    throw new RangeError(
      `advanceDays: maxDays must be a whole number from 1 to ${String(MAX_ADVANCE_DAYS)}, got ${describeValue(maxDays)}`,
    );
  }
  if (stopAtDate !== undefined) {
    if (!isGameDate(stopAtDate)) {
      throw new RangeError(
        `advanceDays: stopAtDate must be a date in the form YYYY-MM-DD, got ${describeValue(stopAtDate)}`,
      );
    }
    if (!isAfter(stopAtDate, currentDate)) {
      throw new RangeError(
        `advanceDays: stopAtDate must be after the current date ${currentDate}, got ${stopAtDate}`,
      );
    }
  }
}

/** The failed steps of one day, in day order, with their error messages. */
function failedSteps(report: DayReport): AdvanceFailure[] {
  return report.steps
    .filter((step) => step.status === 'failed')
    .map((step) => ({
      date: report.date,
      stepId: step.stepId,
      message: step.error?.message ?? 'unknown error',
    }));
}

/** The gate that stops at the start of `stopAtDate`. */
function stopDateGate<R extends TableRegistry>(stopAtDate: GameDate): GateSpec<R> {
  return {
    id: STOP_DATE_GATE_ID,
    label: 'Stop date',
    check: (_view, date) =>
      date === stopAtDate
        ? { gateId: STOP_DATE_GATE_ID, reason: 'Reached the date you asked to stop at' }
        : null,
  };
}

/**
 * The gate that stops when one step has failed on each of the last `threshold` days of this
 * advance. `days` holds each simulated day's failed steps, oldest first.
 */
function repeatedFailureGate<R extends TableRegistry>(
  days: readonly (readonly AdvanceFailure[])[],
  threshold: number,
): GateSpec<R> {
  return {
    id: REPEATED_FAILURE_GATE_ID,
    label: 'Repeated failure',
    check: () => {
      if (days.length < threshold) {
        return null;
      }
      const recent = days.slice(-threshold);
      const latest = recent[recent.length - 1] ?? [];
      const repeated = latest.find((failure) =>
        recent.every((day) => day.some((earlier) => earlier.stepId === failure.stepId)),
      );
      if (repeated === undefined) {
        return null;
      }
      const dayWord = threshold === 1 ? 'day' : `${String(threshold)} days`;
      return {
        gateId: REPEATED_FAILURE_GATE_ID,
        reason: `The skip stopped because "${repeated.stepId}" failed on each of the last ${dayWord}. Last error: ${repeated.message}`,
      };
    },
  };
}

/**
 * Simulates up to `maxDays` days, stopping early at the first gate hit (checked before each day),
 * or when `signal.aborted` is set (checked after each day's yield, and once before the first day).
 *
 * Throws `RangeError` for a `maxDays` that is not a whole number from 1 to 3650, or a `stopAtDate`
 * that is not after the current date. A failing phase never throws; only the errors `runDay`
 * itself throws (its closing step failing) come through.
 */
export async function advanceDays<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  options: AdvanceOptions,
): Promise<AdvanceResult> {
  const startDate = runtime.world.meta.currentDate;
  validateOptions(options, startDate);
  const { maxDays, stopAtDate, signal, onDay } = options;
  const yieldToHost = options.yieldToHost ?? defaultYieldToHost;

  const startedAt = runtime.host.now();
  const seqBefore = runtime.bus.seq;
  const failures: AdvanceFailure[] = [];
  const failuresByDay: AdvanceFailure[][] = [];
  const builtInGates: GateSpec<R>[] = [];
  if (stopAtDate !== undefined) {
    builtInGates.push(stopDateGate<R>(stopAtDate));
  }
  builtInGates.push(
    repeatedFailureGate<R>(
      failuresByDay,
      runtime.tunables.get('sim.stopSkipAfterConsecutiveFailures'),
    ),
  );
  const gateState = {
    world: runtime.world,
    gates: GateRegistry.extend(runtime.gates, builtInGates),
  };

  let daysAdvanced = 0;
  let stoppedBy: AdvanceStop = { kind: 'completed' };
  if (signal?.aborted === true) {
    stoppedBy = { kind: 'cancelled' };
  }

  while (stoppedBy.kind === 'completed' && daysAdvanced < maxDays) {
    const hits = evaluateGates(gateState, runtime.world.meta.currentDate);
    if (hits.length > 0) {
      stoppedBy = { kind: 'gate', hits };
      break;
    }

    const report = runDay(runtime);
    runtime.lastDayReport = report;
    daysAdvanced += 1;
    const dayFailures = failedSteps(report);
    failures.push(...dayFailures);
    failuresByDay.push(dayFailures);

    onDay?.({
      dayIndex: daysAdvanced,
      date: report.date,
      totalDays: maxDays,
      failedCount: report.failedCount,
    });
    await yieldToHost();
    if (signal?.aborted === true) {
      stoppedBy = { kind: 'cancelled' };
    }
  }

  return {
    startDate,
    endDate: runtime.world.meta.currentDate,
    daysAdvanced,
    stoppedBy,
    failures,
    eventsPublished: runtime.bus.seq - seqBefore,
    timing: { ms: runtime.host.now() - startedAt },
  };
}
