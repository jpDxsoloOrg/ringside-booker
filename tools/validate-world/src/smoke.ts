/**
 * `--smoke-days n`: after a world loads, run it forward `n` days through the engine's public API
 * and fail if any day-pipeline step reported an error.
 *
 * The run goes through `initialEngineState`, `createEngine` with `defaultSystems`, and
 * `engine.advanceDays`, exactly as a new game would.
 */

import {
  createEngine,
  defaultSystems,
  initialEngineState,
  MAX_ADVANCE_DAYS,
  type AdvanceFailure,
  type Engine,
  type LoadedWorld,
} from '@ringside/engine';

export type SmokeOutcome =
  | { readonly status: 'passed'; readonly daysAdvanced: number }
  | {
      readonly status: 'failed';
      readonly daysAdvanced: number;
      readonly failures: readonly string[];
    };

/** The most failures listed in the outcome. */
const MAX_LISTED_FAILURES = 20;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFailure(failure: AdvanceFailure): string {
  return `${failure.date} ${failure.stepId}: ${failure.message}`;
}

/** Advances the loaded world `days` days and collects every reported step failure. */
export async function runSmokeDays(loaded: LoadedWorld, days: number): Promise<SmokeOutcome> {
  const failures: string[] = [];
  let daysAdvanced = 0;
  let engine: Engine;
  try {
    engine = createEngine({ state: initialEngineState(loaded.world), systems: defaultSystems });
  } catch (error: unknown) {
    return {
      status: 'failed',
      daysAdvanced,
      failures: [`the engine did not start: ${describeError(error)}`],
    };
  }
  while (daysAdvanced < days) {
    try {
      const result = await engine.advanceDays({
        maxDays: Math.min(days - daysAdvanced, MAX_ADVANCE_DAYS),
      });
      failures.push(...result.failures.map(describeFailure));
      if (result.daysAdvanced <= 0) {
        failures.push(`stopped after ${String(daysAdvanced)} days (${result.stoppedBy.kind})`);
        break;
      }
      daysAdvanced += result.daysAdvanced;
    } catch (error: unknown) {
      failures.push(
        `advanceDays threw after ${String(daysAdvanced)} days: ${describeError(error)}`,
      );
      break;
    }
  }
  if (failures.length > 0) {
    return { status: 'failed', daysAdvanced, failures: failures.slice(0, MAX_LISTED_FAILURES) };
  }
  return { status: 'passed', daysAdvanced };
}
