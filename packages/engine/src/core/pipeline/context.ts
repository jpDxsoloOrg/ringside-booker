/**
 * What a step's code is handed while it runs.
 *
 * Phases, reactions and (later) commands all get the same context. Everything in it belongs to the
 * step's own unit of work: `tx` is the step's transaction, `publish` and `recordTrace` write into
 * the step's own stagings, and `rng` hands out streams whose state is snapshotted before the step
 * starts. If the step throws, all of it is rolled back together.
 *
 * New entities are created with `ctx.tx.create(...)`, which mints IDs through the world's ID
 * factory (the seeded minter the runtime installs), so there is no separate `ids` handle.
 */

import type { GameTables } from '../../model/tables';
import type { TableRegistry } from '../../model/table-def';
import type { Tx } from '../../model/tx';
import type { WorldView } from '../../model/world';
import type { EngineTunables } from '../../systems/tunables';
import type { GameDate } from '../date';
import type { EventStaging } from '../events/bus';
import type { RngStream } from '../rng/registry';
import type { StreamName } from '../rng/streams';
import type { TraceStaging } from '../trace/store';

/** The context of one step. `R` is the table registry (the game's, or a test registry). */
export interface StepContext<R extends TableRegistry = GameTables> {
  /** The game date being simulated. Every step of a day sees the same date. */
  readonly date: GameDate;
  /** The step's transaction: the only way to write to the world. */
  readonly tx: Tx<R>;
  /** The world as it stands, including this step's own writes so far (`tx.view`). */
  readonly read: WorldView<R>;
  /** A named random stream. Draws are rolled back with everything else if the step fails. */
  readonly rng: (name: StreamName) => RngStream;
  /** Every engine tunable, typed by key. */
  readonly tunables: EngineTunables;
  /** Stages a domain event. Delivered only if the step commits. */
  readonly publish: EventStaging['publish'];
  /** Stages a calculation trace. Stored only if the step commits. */
  readonly recordTrace: TraceStaging['record'];
  /** Stages a full trace's demotion to its summary. Applied only if the step commits. */
  readonly demoteTrace: TraceStaging['demote'];
  /** Adds a line to the step's report. Kept even when the step fails, to help find out why. */
  readonly log: (message: string) => void;
}

/** What a phase's `run` receives. */
export type PhaseContext<R extends TableRegistry = GameTables> = StepContext<R>;

/** What a reaction (event subscriber) receives: its own transaction, stagings and RNG snapshot. */
export type ReactionContext<R extends TableRegistry = GameTables> = StepContext<R>;
