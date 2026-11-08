/**
 * One step, fully isolated: the pipeline's commit-or-roll-back wrapper.
 *
 * A step (a phase, one of the engine's own day steps, or later a command) runs inside its own
 * world transaction, with its own event staging, its own trace staging and a snapshot of the RNG.
 * When it returns, its writes are kept, its traces stored and its events committed and delivered.
 * When it throws, the transaction has already rolled its writes back; the RNG is put back where it
 * was, and its staged events and traces are dropped, so the failed step leaves nothing behind but
 * an entry in the report, the failure log and a `pipeline.stepFailed` event.
 *
 * Every reaction to the step's events goes through the same wrapper, with its own transaction,
 * stagings and RNG snapshot, so a broken subscriber loses only its own work.
 *
 * Everything here is synchronous: `world.transact` refuses a body that returns a promise, and
 * nothing in this file may wrap it in anything async.
 */

import type { TableRegistry } from '../../model/table-def';
import type { GameDate } from '../date';
import { serializeError, type SerializedError } from '../errors';
import type { ReactionRunner } from '../events/bus';
import type { AnyDomainEvent, EventSource } from '../events/types';
import { refKey, type TraceStaging } from '../trace/store';
import type { StepContext } from './context';
import type { PhaseGroup } from './groups';
import type { ReactionFailureReport, StepReport } from './report';
import type { SimRuntime } from './runtime';

/** Optional details of a step. */
export interface RunStepOptions {
  /** The step's phase group; null (the default) for a step outside the day, such as a command. */
  readonly group?: PhaseGroup | null;
  /** The date the step simulates. Defaults to the world's current date. */
  readonly date?: GameDate;
  /**
   * Publish `pipeline.stepFailed` when the step fails. Defaults to true. Commands turn it off: a
   * failed command hands its error straight back to the caller and must leave the event log
   * exactly as it was, so it is only recorded in the failure log.
   */
  readonly announceFailure?: boolean;
}

/** The step id failures of a reaction are logged under: `reaction:<subscriberId>`. */
export function reactionStepId(subscriberId: string): string {
  return `reaction:${subscriberId}`;
}

type UnitOutcome =
  | { readonly ok: true; readonly events: readonly AnyDomainEvent[]; readonly traces: number }
  | { readonly ok: false; readonly error: Error };

/**
 * Runs one unit of work (a step or a reaction) and commits or rolls back everything it did. Does
 * not dispatch: the caller decides what happens to the committed events.
 */
function runUnit<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  label: string,
  source: EventSource,
  date: GameDate,
  // Typed `unknown` so whatever `run` returns reaches `transact` (see below).
  run: (ctx: StepContext<R>) => unknown,
  log: (message: string) => void,
): UnitOutcome {
  const rngSnapshot = runtime.rng.snapshot();
  const eventStaging = runtime.bus.stage(source, date);
  const traceStaging = runtime.traces.stage();
  const recordedRefs = new Set<string>();
  const recordTrace: TraceStaging['record'] = (ref, traceDate, traced) => {
    traceStaging.record(ref, traceDate, traced);
    recordedRefs.add(refKey(ref));
  };

  // `run` is typed to return void, but a function returning a promise still fits that type. Its
  // result is handed back to `transact`, which refuses (and rolls back) a body that returns one.
  const result = runtime.world.transact(label, (tx) =>
    run({
      date,
      tx,
      read: tx.view,
      rng: (name) => runtime.rng.stream(name),
      tunables: runtime.tunables,
      publish: eventStaging.publish,
      recordTrace,
      log,
    }),
  );

  if (result.ok) {
    traceStaging.commit();
    return { ok: true, events: eventStaging.commit(), traces: recordedRefs.size };
  }
  // The transaction has already undone the step's writes; put back everything else it touched.
  runtime.rng.restore(rngSnapshot);
  eventStaging.discard();
  traceStaging.discard();
  return { ok: false, error: result.error };
}

/**
 * Delivers committed events to their reactions, each reaction through {@link runUnit}. Failed
 * reactions are added to `reactionFailures` and the failure log; observer failures and events cut
 * off by the cascade limit become log lines.
 */
function deliver<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  events: readonly AnyDomainEvent[],
  logs: string[],
  reactionFailures: ReactionFailureReport[],
): void {
  if (events.length === 0) {
    return;
  }
  const runReaction: ReactionRunner<StepContext<R>> = (subscriberId, run, event) => {
    const stepId = reactionStepId(subscriberId);
    const outcome = runUnit(
      runtime,
      stepId,
      { kind: 'reaction', id: subscriberId },
      event.date,
      run,
      (message) => logs.push(`${subscriberId}: ${message}`),
    );
    if (outcome.ok) {
      return { status: 'committed', events: outcome.events };
    }
    runtime.failureLog.record({ date: event.date, stepId, error: serializeError(outcome.error) });
    return { status: 'failed', error: outcome.error };
  };

  const report = runtime.bus.dispatch(events, runReaction);
  for (const failure of report.failures) {
    reactionFailures.push({
      subscriberId: failure.subscriberId,
      eventSeq: failure.eventSeq,
      error: serializeError(failure.error),
    });
  }
  for (const failure of report.observerFailures) {
    logs.push(
      `Observer ${String(failure.observerNumber)} failed on event ${String(failure.eventSeq)} (${failure.eventType}): ${failure.message}`,
    );
  }
  if (report.dropped.eventSeqs.length > 0) {
    logs.push(
      `Event cascade limit reached: events ${report.dropped.eventSeqs.join(', ')} (${report.dropped.eventTypes.join(', ')}) were not delivered to reactions`,
    );
  }
}

/** The details of a step that failed, for {@link reportStepFailure}. */
export interface StepFailure {
  readonly stepId: string;
  readonly group: PhaseGroup | null;
  readonly source: EventSource;
  readonly date: GameDate;
  /** What was thrown. */
  readonly error: unknown;
  /** The host time the step started, for its timing. */
  readonly startedAt: number;
  /** Lines the step logged before it failed. */
  readonly logs?: readonly string[];
  /** Publish `pipeline.stepFailed` for it. Defaults to true. */
  readonly announce?: boolean;
}

/**
 * Records a failed step: adds it to the failure log, publishes `pipeline.stepFailed` from a fresh
 * staging that is committed (and delivered) straight away (unless `announce` is false), and
 * returns the failed report. Used by {@link runStep} and by the day runner when a phase's
 * condition throws.
 */
export function reportStepFailure<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  failure: StepFailure,
): StepReport {
  const { stepId, group, source, date } = failure;
  const error: SerializedError = serializeError(failure.error);
  runtime.failureLog.record({ date, stepId, error });

  const logs = [...(failure.logs ?? [])];
  const reactionFailures: ReactionFailureReport[] = [];
  if (failure.announce !== false) {
    const notice = runtime.bus.stage(source, date);
    notice.publish('pipeline.stepFailed', { stepId, message: error.message });
    deliver(runtime, notice.commit(), logs, reactionFailures);
  }

  return {
    stepId,
    group,
    status: 'failed',
    error,
    eventsPublished: 0,
    tracesRecorded: 0,
    reactionFailures,
    logs,
    timing: { ms: runtime.host.now() - failure.startedAt },
  };
}

/**
 * Runs one step through the commit-or-roll-back wrapper and returns its report.
 *
 * On success the step's traces are stored, its events committed and then delivered to their
 * reactions. On failure its writes, RNG draws, events and traces are all rolled back, the error is
 * recorded, and `pipeline.stepFailed` is published (unless `announceFailure` is false). Never
 * throws for an error inside `run`.
 */
export function runStep<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  stepId: string,
  source: EventSource,
  run: (ctx: StepContext<R>) => void,
  options: RunStepOptions = {},
): StepReport {
  const startedAt = runtime.host.now();
  const date = options.date ?? runtime.world.meta.currentDate;
  const group = options.group ?? null;
  const logs: string[] = [];

  const outcome = runUnit(runtime, stepId, source, date, run, (message) => logs.push(message));
  if (!outcome.ok) {
    return reportStepFailure(runtime, {
      stepId,
      group,
      source,
      date,
      error: outcome.error,
      startedAt,
      logs,
      announce: options.announceFailure ?? true,
    });
  }

  const reactionFailures: ReactionFailureReport[] = [];
  deliver(runtime, outcome.events, logs, reactionFailures);
  return {
    stepId,
    group,
    status: 'ok',
    eventsPublished: outcome.events.length,
    tracesRecorded: outcome.traces,
    reactionFailures,
    logs,
    timing: { ms: runtime.host.now() - startedAt },
  };
}
