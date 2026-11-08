/**
 * A test engine for the engine host and hook tests: the real `createEngine` over the shared tiny
 * fixture world (one promotion run by the human `player-1`), plus a small test system:
 *
 * - query `counter.get` and command `counter.increment` (refused for a negative amount);
 * - query `fakeEngine.viewer`, which hands back the viewer it ran for;
 * - query `fakeEngine.rows`, which smuggles a `Map` into row 3 to trip the plain-JSON check;
 * - a gate that stops a multi-day advance at the start of a chosen date.
 */

import { z } from 'zod';
import {
  addDays,
  createEngine,
  defineCommand,
  defineGate,
  defineQuery,
  defineSystem,
  initialEngineState,
} from '@ringside/engine';
import type {
  CreateEngineOptions,
  Engine,
  EngineState,
  GameDate,
  SystemBundle,
  Viewer,
} from '@ringside/engine';
import { TINY_WORLD_TODAY, tinyWorld } from '@ringside/engine/testing';
import type { EngineFactory } from '@/worker/engineHost';

declare module '@ringside/engine' {
  interface QueryMap {
    'counter.get': { args: Record<string, never>; result: { value: number } };
    'fakeEngine.viewer': { args: Record<string, never>; result: Viewer };
    'fakeEngine.rows': { args: Record<string, never>; result: { rows: { contract: string }[] } };
  }
  interface CommandMap {
    'counter.increment': { args: { amount: number }; result: { value: number } };
  }
}

/** The gate's id, as it appears in `stoppedBy.hits`. */
export const FAKE_GATE_ID = 'fakeEngine.stopDay';

/** The date the fake world starts on. */
export const FAKE_START_DATE: GameDate = TINY_WORLD_TODAY;

/** The tiny world's state as a new game. Every call builds a fresh copy. */
export function fakeEngineState(): EngineState {
  return initialEngineState(tinyWorld().world);
}

/** The date of the `dayNumber`-th day of an advance from the start (day 1 is the start date). */
export function fakeAdvanceDay(dayNumber: number): GameDate {
  return addDays(FAKE_START_DATE, dayNumber - 1);
}

export interface FakeEngineOptions {
  /** A multi-day advance stops at the start of this date. Never, when left out. */
  readonly gateDate?: GameDate;
}

const noArgs = z.strictObject({});

/** Puts a Map where the type says a string goes, the way a buggy query would. */
function smuggleMap(row: { contract: string }): { contract: string } {
  Reflect.set(row, 'contract', new Map([['wage', 1]]));
  return row;
}

/** The test system. The counter lives in the closure, one per engine. */
function fakeSystem(options: FakeEngineOptions): SystemBundle {
  let counter = 0;
  return defineSystem({
    id: 'fakeEngine',
    queries: [
      defineQuery('counter.get', { args: noArgs, run: () => ({ value: counter }) }),
      defineQuery('fakeEngine.viewer', { args: noArgs, run: (ctx) => ctx.viewer }),
      defineQuery('fakeEngine.rows', {
        args: noArgs,
        run: () => ({
          rows: [
            { contract: 'a' },
            { contract: 'b' },
            { contract: 'c' },
            smuggleMap({ contract: 'd' }),
          ],
        }),
      }),
    ],
    commands: [
      defineCommand('counter.increment', {
        args: z.strictObject({ amount: z.number().int() }),
        validate: (_read, args) =>
          args.amount >= 0
            ? []
            : [
                {
                  code: 'negativeAmount',
                  message: 'The counter only goes up.',
                  field: 'amount',
                },
              ],
        apply: (_ctx, args) => {
          counter += args.amount;
          return { value: counter };
        },
      }),
    ],
    gates: [
      defineGate({
        id: FAKE_GATE_ID,
        label: 'Test stop day',
        check: (_view, date) =>
          date === options.gateDate ? { gateId: FAKE_GATE_ID, reason: 'Test stop day' } : null,
      }),
    ],
  });
}

/** An engine factory that adds the test system to whatever the host asks for. */
export function fakeEngineFactory(options: FakeEngineOptions = {}): EngineFactory {
  return (engineOptions: CreateEngineOptions): Engine =>
    createEngine({ ...engineOptions, systems: [...engineOptions.systems, fakeSystem(options)] });
}
