/**
 * `--smoke-days n`: after a world loads, run it forward `n` days through the engine's public API
 * and fail if any day-pipeline step reported an error.
 *
 * The run goes through `initialEngineState`, `createEngine` and `engine.advanceDays`. Until the
 * engine exports all three, the smoke run is skipped with a notice instead of failing, so the
 * option can sit in scripts before the headless API is finished. The exports are looked up at run
 * time and every value they return is checked before it is used.
 */

import * as engineModule from '@ringside/engine';
import type { LoadedWorld } from '@ringside/engine';

export type SmokeOutcome =
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'passed'; readonly daysAdvanced: number }
  | {
      readonly status: 'failed';
      readonly daysAdvanced: number;
      readonly failures: readonly string[];
    };

/** The most days one `advanceDays` call is asked for; longer runs loop. */
const MAX_DAYS_PER_CALL = 3650;

/** The most failures listed in the outcome. */
const MAX_LISTED_FAILURES = 20;

type AnyFunction = (...args: unknown[]) => unknown;

function isFunction(value: unknown): value is AnyFunction {
  return typeof value === 'function';
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, name: string): unknown {
  return isObject(value) ? Reflect.get(value, name) : undefined;
}

function describeFailure(failure: unknown): string {
  const date = field(failure, 'date');
  const stepId = field(failure, 'stepId');
  const message = field(failure, 'message');
  return `${typeof date === 'string' ? date : '?'} ${typeof stepId === 'string' ? stepId : '?'}: ${typeof message === 'string' ? message : JSON.stringify(failure)}`;
}

/** The engine's headless API, when it is exported. */
interface HeadlessApi {
  readonly createEngine: AnyFunction;
  readonly initialEngineState: AnyFunction;
  readonly defaultSystems: unknown;
}

function headlessApi(): HeadlessApi | null {
  const createEngine: unknown = Reflect.get(engineModule, 'createEngine');
  const initialEngineState: unknown = Reflect.get(engineModule, 'initialEngineState');
  const defaultSystems: unknown = Reflect.get(engineModule, 'defaultSystems');
  if (
    !isFunction(createEngine) ||
    !isFunction(initialEngineState) ||
    defaultSystems === undefined
  ) {
    return null;
  }
  return { createEngine, initialEngineState, defaultSystems };
}

/** Advances the loaded world `days` days and collects every reported step failure. */
export async function runSmokeDays(loaded: LoadedWorld, days: number): Promise<SmokeOutcome> {
  const api = headlessApi();
  if (api === null) {
    return {
      status: 'skipped',
      reason:
        'the engine does not export the headless API (createEngine, initialEngineState, defaultSystems) yet',
    };
  }
  const state = api.initialEngineState(loaded.world);
  const engine = api.createEngine({ state, systems: api.defaultSystems });
  const advanceDays = field(engine, 'advanceDays');
  if (!isFunction(advanceDays)) {
    return { status: 'skipped', reason: 'the engine object has no advanceDays method' };
  }
  const failures: string[] = [];
  let daysAdvanced = 0;
  while (daysAdvanced < days) {
    const result: unknown = await advanceDays.call(engine, {
      maxDays: Math.min(days - daysAdvanced, MAX_DAYS_PER_CALL),
    });
    const advanced = field(result, 'daysAdvanced');
    const reported = field(result, 'failures');
    if (Array.isArray(reported)) {
      const list: unknown[] = reported;
      failures.push(...list.map(describeFailure));
    }
    if (typeof advanced !== 'number' || advanced <= 0) {
      const stoppedBy = field(field(result, 'stoppedBy'), 'kind');
      failures.push(
        `stopped after ${String(daysAdvanced)} days (${typeof stoppedBy === 'string' ? stoppedBy : 'no progress'})`,
      );
      break;
    }
    daysAdvanced += advanced;
  }
  if (failures.length > 0) {
    return { status: 'failed', daysAdvanced, failures: failures.slice(0, MAX_LISTED_FAILURES) };
  }
  return { status: 'passed', daysAdvanced };
}
