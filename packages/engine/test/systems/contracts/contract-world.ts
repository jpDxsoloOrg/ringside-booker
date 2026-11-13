/**
 * Worlds and a runtime for the contracts tests: a runtime that runs only the contracts and finance
 * phases (so a day is the lifecycle, then payroll), plus any test phases.
 */

import { addDays, type GameDate } from '../../../src/core/date';
import type { EmploymentId } from '../../../src/core/ids';
import type { PhaseDefinition } from '../../../src/core/pipeline/phase';
import { PhaseRegistry } from '../../../src/core/pipeline/registry';
import { runDay, type DayReport } from '../../../src/core/pipeline/runDay';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { GameWorld } from '../../../src/model/tables';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';

/**
 * A runtime over `world` with the contracts phases, the finance phases (unless `finance` is false)
 * and any `extra` phases.
 */
export function contractsRuntime(
  world: GameWorld,
  overrides: TunableOverrides = {},
  extra: readonly PhaseDefinition[] = [],
  finance = true,
): SimRuntime {
  const phases = new PhaseRegistry();
  const financePhases = finance ? financeSystem.phases : [];
  for (const phase of [...contractsSystem.phases, ...financePhases, ...extra]) {
    phases.register(phase);
  }
  return createRuntime({ world, tunables: createEngineTunables(overrides), phases });
}

/** Runs `days` days and fails on any failed step. Returns the last day's report. */
export function runDays(runtime: SimRuntime, days: number): DayReport | undefined {
  let last: DayReport | undefined;
  for (let day = 0; day < days; day += 1) {
    last = runDay(runtime);
    const failed = last.steps.find((step) => step.status === 'failed');
    if (failed !== undefined) {
      throw new Error(`Step ${failed.stepId} failed on ${last.date}: ${JSON.stringify(failed)}`);
    }
  }
  return last;
}

/** Runs days until the world's date is `date` has been simulated (the clock is past it). */
export function runThrough(runtime: SimRuntime, date: GameDate): void {
  while (runtime.world.meta.currentDate <= date) {
    runDays(runtime, 1);
  }
}

/** Sets an employment's end date (a test edit, outside the lifecycle). */
export function setEndsOn(world: GameWorld, employmentId: EmploymentId, endsOn: GameDate): void {
  const result = world.transact('test: end date', (tx) => {
    tx.update('employments', employmentId, { endsOn });
  });
  if (!result.ok) {
    throw result.error;
  }
}

/** The day after `date`. */
export function nextDay(date: GameDate): GameDate {
  return addDays(date, 1);
}
