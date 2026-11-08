/**
 * One day of the simulation.
 *
 * The contract: a day simulates date D in full, then the clock moves to D + 1. The engine's `open`
 * step announces the day, every registered phase whose cadence and condition match D runs in
 * group-then-order sequence (each in its own isolated step), and the engine's `close` step moves
 * the world date forward and announces the end of the day with the number of failed steps.
 *
 * A failing phase never stops the day. Only a failure of the `close` step itself, which would leave
 * the clock where it was, is thrown, because carrying on would simulate the same date again.
 *
 * See docs/design/day-pipeline.md.
 */

import type { TableRegistry } from '../../model/table-def';
import { matchesCadence } from '../calendar/cadence';
import { addDays, type GameDate } from '../date';
import { InvariantError } from '../errors';
import type { EventSource } from '../events/types';
import type { PhaseDefinition } from './phase';
import { skippedStepReport, type DayReport, type StepReport } from './report';
import { reportStepFailure, runStep } from './runStep';
import type { SimRuntime } from './runtime';

/** The engine's step that starts a day and publishes `day.started`. */
export const OPEN_STEP_ID = 'pipeline.open';
/** The engine's step that moves the clock to the next day and publishes `day.ended`. */
export const CLOSE_STEP_ID = 'pipeline.close';

function phaseSource(id: string): EventSource {
  return { kind: 'phase', id };
}

function countFailed(steps: readonly StepReport[]): number {
  return steps.filter((step) => step.status === 'failed').length;
}

/** Runs one registered phase on `date`, or reports why it was skipped. */
function runPhase<R extends TableRegistry>(
  runtime: SimRuntime<R>,
  phase: PhaseDefinition<R>,
  date: GameDate,
): StepReport {
  if (!matchesCadence(date, phase.cadence)) {
    return skippedStepReport(phase.id, phase.group, 'cadence');
  }
  const source = phaseSource(phase.id);
  if (phase.when !== undefined) {
    const startedAt = runtime.host.now();
    let enabled: boolean;
    try {
      enabled = phase.when(runtime.world);
    } catch (error: unknown) {
      return reportStepFailure(runtime, {
        stepId: phase.id,
        group: phase.group,
        source,
        date,
        error,
        startedAt,
      });
    }
    if (!enabled) {
      return skippedStepReport(phase.id, phase.group, 'condition');
    }
  }
  return runStep(runtime, phase.id, source, phase.run, { group: phase.group, date });
}

/**
 * Simulates the world's current date and then advances the world date by exactly one day.
 * Returns the day's report. Throws {@link InvariantError} only if the closing step itself fails.
 */
export function runDay<R extends TableRegistry>(runtime: SimRuntime<R>): DayReport {
  const startedAt = runtime.host.now();
  const date = runtime.world.meta.currentDate;
  const seqBefore = runtime.bus.seq;
  const steps: StepReport[] = [];

  steps.push(
    runStep(
      runtime,
      OPEN_STEP_ID,
      phaseSource(OPEN_STEP_ID),
      (ctx) => {
        ctx.publish('day.started', { date });
      },
      { group: 'open', date },
    ),
  );

  for (const phase of runtime.phases.ordered()) {
    steps.push(runPhase(runtime, phase, date));
  }

  const failedSteps = countFailed(steps);
  const closeReport = runStep(
    runtime,
    CLOSE_STEP_ID,
    phaseSource(CLOSE_STEP_ID),
    (ctx) => {
      ctx.tx.setMeta({
        currentDate: addDays(date, 1),
        daysSimulated: ctx.read.meta.daysSimulated + 1,
      });
      ctx.publish('day.ended', { date, failedSteps });
    },
    { group: 'close', date },
  );
  steps.push(closeReport);
  if (closeReport.status === 'failed') {
    throw new InvariantError(
      `Day ${date} could not be closed, so the clock did not move: ${closeReport.error?.message ?? 'unknown error'}`,
      { date, stepId: CLOSE_STEP_ID },
    );
  }

  return {
    date,
    steps,
    failedCount: countFailed(steps),
    eventsPublished: runtime.bus.seq - seqBefore,
    timing: { ms: runtime.host.now() - startedAt },
  };
}
