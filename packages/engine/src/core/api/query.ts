/**
 * Queries: read-only views of the world, shaped for one screen and returned as plain JSON.
 *
 * A query is declared once with {@link defineQuery}, added to a system bundle, and called by name
 * through `engine.query(name, args, viewer)`. Its arguments are checked with its zod schema before
 * `run` sees them. `run` gets a {@link QueryContext}: the world, the viewer, the tunables, the trace
 * store, the recent events and the gates, all read-only. A query never gets a transaction, so it
 * cannot change anything.
 *
 * Each system decides what a viewer may see of its own data (rival finances, other promotions'
 * offers). The engine passes the viewer through; it does not filter for the system.
 */

import type { z } from 'zod';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../../systems/tunables';
import type { GameDate } from '../date';
import { RegistryError } from '../errors';
import type { AnyDomainEvent } from '../events/types';
import type { GateHit } from '../pipeline/gates';
import type { PipelineFailure } from '../pipeline/failureLog';
import type { DayReport } from '../pipeline/report';
import type { TraceStore } from '../trace/store';
import type { CommandLogEntry } from './commandLog';
import type { Viewer } from './controller';
import type { QueryArgs, QueryData, QueryName } from './maps';

/** A query or command name: dot-separated camelCase words, such as `roster.rows`. */
export const API_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

/** The read side of the trace store. */
export type TraceReader = Pick<TraceStore, 'get' | 'has' | 'listByKind'>;

/** The read side of the recent-event log. */
export interface EventLogReader {
  /** The newest kept events, oldest first; with `limit`, only the last that many. */
  recent(query?: { readonly limit?: number }): AnyDomainEvent[];
}

/** What a query's `run` receives. Everything in it is read-only. */
export interface QueryContext {
  /** The world as it stands. */
  readonly read: GameWorldView;
  /** Who the query runs for. Systems use it to hide what that viewer's promotion would not know. */
  readonly viewer: Viewer;
  /** Every engine tunable, typed by key. */
  readonly tunables: EngineTunables;
  /** Stored calculation traces. */
  readonly traces: TraceReader;
  /** The recent-event log. */
  readonly events: EventLogReader;
  /**
   * Runs every registered gate for `date` without advancing, exactly as the multi-day advance
   * would before simulating that day (SIM-09's `evaluateGates`).
   */
  readonly gates: (date: GameDate) => GateHit[];
  /** The world's current date. */
  readonly date: GameDate;
  /** The report of the last day an advance simulated, or null before the first one. Not saved. */
  readonly lastDayReport: DayReport | null;
  /** The pipeline failure log, oldest first; with `limit`, only the newest that many. */
  readonly failures: (limit?: number) => PipelineFailure[];
  /** The command log, oldest first; with `limit`, only the newest that many. */
  readonly commands: (limit?: number) => CommandLogEntry[];
}

/** What a system writes to define a query. */
export interface QuerySpec<N extends QueryName> {
  /** Checks the arguments. Its output is what `run` receives. */
  readonly args: z.ZodType<QueryArgs<N>>;
  /**
   * Builds the view. Must only read, and must return plain JSON (checked in debug builds). Written
   * as a method so a definition for one name fits in a list of definitions for any name.
   */
  run(ctx: QueryContext, args: QueryArgs<N>): QueryData<N>;
}

/** A checked, frozen query definition, ready to add to a system bundle. */
export interface QueryDefinition<N extends QueryName = QueryName> extends QuerySpec<N> {
  readonly name: N;
}

/**
 * Checks a query spec and returns a frozen definition. Throws {@link RegistryError} for a name that
 * is not dot-separated camelCase words.
 */
export function defineQuery<N extends QueryName>(name: N, spec: QuerySpec<N>): QueryDefinition<N> {
  if (!API_NAME_PATTERN.test(name)) {
    throw new RegistryError(
      `Query name ${JSON.stringify(name)} must look like "area.noun", for example "roster.rows"`,
      { query: name },
    );
  }
  return Object.freeze({
    name,
    args: spec.args,
    run: (ctx: QueryContext, args: QueryArgs<N>) => spec.run(ctx, args),
  });
}
