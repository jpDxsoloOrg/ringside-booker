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
import { bookingTunables } from './booking/tunables';
import { calendarTunables } from './calendar/tunables';
import { conditionTunables } from './condition/tunables';
import { matchTunables } from './match/tunables';
import { aftermathTunables } from './match/aftermath/tunables';
import { mergeTunables } from '../core/tunables/define';
import type { TunableOverrides } from '../core/tunables/overrides';
import {
  createTunables,
  loadTunables,
  type LoadedTunables,
  type TunableReader,
} from '../core/tunables/resolver';
import { promoPopTunables } from './promoPop/tunables';
import { showsTunables } from './shows/tunables';
import { workersTunables } from './workers/tunables';
import { worldTunables } from './world/tunables';
import { momentumTunables } from './match/aftermath/momentumTunables';

import { financeTunables } from './finance/tunables';
import { boxOfficeTunables } from './boxOffice/tunables';
import { officeTunables } from './office/tunables';
import { rosterTunables } from './roster/tunables';
import { aipTunables } from './aip/tunables';
import { aipCardTunables } from './aip/card/tunables';
import { aipResultsTunables } from './aip/results/tunables';

export const ALL_TUNABLES = mergeTunables(
  simTunables,
  conditionTunables,
  worldTunables,
  workersTunables,
  calendarTunables,
  matchTunables,
  bookingTunables,
  showsTunables,
  aftermathTunables,
  momentumTunables,
  promoPopTunables,
  financeTunables,
  boxOfficeTunables,
  officeTunables,
  rosterTunables,
  aipTunables,
  aipCardTunables,
  aipResultsTunables,
);

/** Every tunable key the engine knows. */
export type TunableKey = keyof typeof ALL_TUNABLES;

/**
 * Every tunable key whose value is a number (`number` and `integer` kinds). Use it for a table of
 * keys a formula reads as numbers; `TunableKey` also covers the enum and boolean tunables.
 */
export type NumberTunableKey = {
  [Key in TunableKey]: (typeof ALL_TUNABLES)[Key]['kind'] extends 'number' | 'integer'
    ? Key
    : never;
}[TunableKey];

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
