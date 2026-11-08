/**
 * The engine state: everything a running game is, as plain JSON.
 *
 * `engine.exportState()` returns it, `createEngine({ state })` starts from it, and a save document
 * stores it under `state` (see docs/design/save-format.md). The World is serialised by FND-11's
 * `serialiseWorld`; each simulation part is the `toState()` of the object that owns it.
 */

import type { RngState } from '../rng/registry';
import { RngRegistry } from '../rng/registry';
import type { EventBusState } from '../events/schema';
import type { PipelineFailureLogState } from '../pipeline/failureLog';
import type { TraceStoreState } from '../trace/store';
import type { TunableOverrides } from '../tunables/overrides';
import { serialiseWorld, type SerialisableWorld } from '../../persistence/world-document';
import type { SerializedWorld } from '../../persistence/save-document';
import { emptyCommandLogState, type CommandLogState } from './commandLog';

/** A running game, as plain JSON. The world seed is `world.meta.seed`; `rng.seed` must equal it. */
export interface EngineState {
  /** The World: its metadata and every table's rows in ascending ID order. */
  world: SerializedWorld;
  /** The touched RNG streams. */
  rng: RngState;
  /** The save's tunable overrides, sorted by key. Never the defaults. */
  tunableOverrides: TunableOverrides;
  /** Recent full traces and older summaries. */
  traces: TraceStoreState;
  /** The event sequence number and the recent-event log. */
  events: EventBusState;
  /** Recent pipeline step failures. */
  failureLog: PipelineFailureLogState;
  /** Recent commands and who issued them. */
  commandLog: CommandLogState;
}

/**
 * The state of a game that has not started yet: `world` serialised as it is, the RNG seeded from
 * `world.meta.seed` with no streams touched, no tunable overrides, and empty traces, events,
 * failures and command log. Used by the new-game command, the test fixtures and the headless
 * runner.
 */
export function initialEngineState(world: SerialisableWorld): EngineState {
  return {
    world: serialiseWorld(world),
    rng: new RngRegistry(world.meta.seed).toState(),
    tunableOverrides: {},
    traces: { version: 1, seq: 0, full: [], summaries: [] },
    events: { version: 1, seq: 0, recent: [] },
    failureLog: { version: 1, entries: [] },
    commandLog: emptyCommandLogState(),
  };
}
