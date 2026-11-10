/**
 * Every tunable in the engine, in one definition set.
 *
 * Each game system declares its balance numbers in `systems/<name>/tunables.ts` with
 * `defineTunables` and adds its set to the `mergeTunables` call below. Merging (instead of an
 * object spread) throws at module load when two systems define the same key. Keeping the aggregate
 * here, rather than registering tunables at runtime, is what lets `TunableKey` be a compile-time
 * union so a misspelt key is a type error.
 */

import { simTunables } from '../core/tunables/simTunables';
import { calendarTunables } from './calendar/tunables';
import { conditionTunables } from './condition/tunables';
import { mergeTunables } from '../core/tunables/define';
import type { TunableOverrides } from '../core/tunables/overrides';
import {
  createTunables,
  loadTunables,
  type LoadedTunables,
  type TunableReader,
} from '../core/tunables/resolver';
import { worldTunables } from './world/tunables';

export const ALL_TUNABLES = mergeTunables(
  simTunables,
  conditionTunables,
  worldTunables,
  calendarTunables,
);

/** Every tunable key the engine knows. */
export type TunableKey = keyof typeof ALL_TUNABLES;

/** The reader formulas take: typed access to every engine tunable. */
export type EngineTunables = TunableReader<typeof ALL_TUNABLES>;

/** Builds the engine's reader from a save's overrides. Invalid overrides are dropped. */
export function createEngineTunables(overrides: TunableOverrides = {}): EngineTunables {
  return createTunables(ALL_TUNABLES, overrides);
}

/** Builds the engine's reader from raw save data, returning the issues for the load report. */
export function loadEngineTunables(
  rawOverrides: Readonly<Record<string, unknown>>,
): LoadedTunables<typeof ALL_TUNABLES> {
  return loadTunables(ALL_TUNABLES, rawOverrides);
}
