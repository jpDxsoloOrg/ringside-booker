/**
 * The simulation runtime: the engine's live state in one container.
 *
 * The world, the RNG, the tunables, the event bus, the trace store, the registered phases and gates,
 * the failure log and the last day's report travel together through every step, so the pipeline takes one argument instead of
 * seven. The host (the Web Worker, the headless runner or a test) supplies the only outside
 * dependency, a `now()` clock used for step timings, so the engine itself never reads the clock.
 */

import type { GameTables } from '../../model/tables';
import type { TableRegistry } from '../../model/table-def';
import type { World } from '../../model/world';
import { createEngineTunables, type EngineTunables } from '../../systems/tunables';
import { PipelineError } from '../errors';
import { EventBus } from '../events/bus';
import { createIdMinter } from '../rng/ids';
import { RngRegistry } from '../rng/registry';
import { TraceStore, traceStoreLimitsFrom } from '../trace/store';
import type { ReactionContext } from './context';
import { PipelineFailureLog } from './failureLog';
import { GateRegistry } from './gates';
import { PhaseRegistry } from './registry';
import type { DayReport } from './report';

/** What the host provides. */
export interface SimHost {
  /** Milliseconds from any fixed point, for step timings only. Defaults to `() => 0`. */
  readonly now: () => number;
}

/** Everything a day needs. `R` is the table registry: the game's, or a test registry. */
export interface SimRuntime<R extends TableRegistry = GameTables> {
  readonly world: World<R>;
  readonly rng: RngRegistry;
  readonly tunables: EngineTunables;
  readonly bus: EventBus<ReactionContext<R>>;
  readonly traces: TraceStore;
  readonly phases: PhaseRegistry<R>;
  /** The checks that stop a multi-day skip before a day is simulated. */
  readonly gates: GateRegistry<R>;
  readonly failureLog: PipelineFailureLog;
  readonly host: SimHost;
  /**
   * The report of the last day `advanceDays` simulated, or null before the first one. Kept for
   * the status query; it is not saved.
   */
  lastDayReport: DayReport | null;
}

/** The parts of a runtime. Everything but the world has a default. */
export interface CreateRuntimeOptions<R extends TableRegistry = GameTables> {
  readonly world: World<R>;
  /** Defaults to a fresh registry seeded with `world.meta.seed`. Its seed must match the world's. */
  readonly rng?: RngRegistry;
  /** Defaults to the engine tunables with no overrides. */
  readonly tunables?: EngineTunables;
  /** Defaults to a bus sized by `sim.eventLogSize` and `sim.maxEventCascadeDepth`. */
  readonly bus?: EventBus<ReactionContext<R>>;
  /** Defaults to an empty store limited by `sim.traceRetentionPerKind` and `sim.traceSummaryLimit`. */
  readonly traces?: TraceStore;
  /** Defaults to an empty registry. */
  readonly phases?: PhaseRegistry<R>;
  /** Defaults to an empty registry. */
  readonly gates?: GateRegistry<R>;
  /** Defaults to an empty log. */
  readonly failureLog?: PipelineFailureLog;
  /** Defaults to `{ now: () => 0 }`. */
  readonly host?: Partial<SimHost>;
}

/**
 * Builds a runtime and installs the seeded ID minter on the world (`world.setIdFactory`), so every
 * `tx.create` draws its ID from the `ids.<prefix>` stream of the row's kind. This replaces any
 * factory the world was created with, such as a sequential test factory.
 *
 * Throws {@link PipelineError} when the RNG registry's seed is not the world's seed.
 */
export function createRuntime<R extends TableRegistry = GameTables>(
  options: CreateRuntimeOptions<R>,
): SimRuntime<R> {
  const { world } = options;
  const rng = options.rng ?? new RngRegistry(world.meta.seed);
  if (rng.seed !== world.meta.seed) {
    throw new PipelineError(
      `The RNG seed ${JSON.stringify(rng.seed)} does not match the world seed ${JSON.stringify(world.meta.seed)}`,
      { rngSeed: rng.seed, worldSeed: world.meta.seed },
    );
  }
  const tunables = options.tunables ?? createEngineTunables();
  const bus =
    options.bus ??
    new EventBus<ReactionContext<R>>({
      logSize: tunables.get('sim.eventLogSize'),
      maxCascadeDepth: tunables.get('sim.maxEventCascadeDepth'),
    });
  const traces = options.traces ?? new TraceStore(traceStoreLimitsFrom(tunables));
  world.setIdFactory(createIdMinter(rng));
  return {
    world,
    rng,
    tunables,
    bus,
    traces,
    phases: options.phases ?? new PhaseRegistry<R>(),
    gates: options.gates ?? new GateRegistry<R>(),
    failureLog: options.failureLog ?? new PipelineFailureLog(),
    host: { now: options.host?.now ?? (() => 0) },
    lastDayReport: null,
  };
}
