import type { QueryArgs, QueryData, QueryName, TraceNode, TraceRef } from '@ringside/engine';

/**
 * A trace built on demand by any engine query whose answer holds it somewhere (ECO5-06): the
 * query runs only when the panel opens, and `select` picks the trace out of the answer, or null
 * when there is none. `contracts.askingTerms`' monthly wage is one: `traceQuery('contracts.askingTerms',
 * args, (ask) => ask.monthlyWage.trace)`.
 */
export interface TraceQuery<Name extends QueryName = QueryName> {
  readonly name: Name;
  readonly args: QueryArgs<Name>;
  // Method syntax on purpose: a query for one name stands in for the general shape.
  select(data: QueryData<Name>): TraceNode | null;
}

/** Builds a `TraceQuery`, checking the arguments and the answer's shape against the query. */
export function traceQuery<Name extends QueryName>(
  name: Name,
  args: QueryArgs<Name>,
  select: (data: QueryData<Name>) => TraceNode | null,
): TraceQuery<Name> {
  return { name, args, select };
}

/**
 * Where a panel gets its trace: handed over inline, fetched from the engine by reference, or
 * picked out of a query's answer when the panel opens.
 */
export type TraceSource =
  | { readonly trace: TraceNode }
  | { readonly traceRef: TraceRef }
  | { readonly traceQuery: TraceQuery };

/** The source for an optional inline trace, reference or query, or null when there is none. */
export function traceSourceOf(
  trace: TraceNode | null | undefined,
  traceRef: TraceRef | null | undefined,
  query?: TraceQuery | null,
): TraceSource | null {
  if (trace !== undefined && trace !== null) return { trace };
  if (traceRef !== undefined && traceRef !== null) return { traceRef };
  if (query !== undefined && query !== null) return { traceQuery: query };
  return null;
}

/**
 * The engine queries that answer with a trace built on demand (`{ value, trace }`), such as
 * `workers.explain`. A `LazyWhyButton` can ask any of them. A query may also answer null when the
 * number has no breakdown (`roster.explain` for a contract that has ended); the panel says so.
 */
export type TraceQueryName = {
  [Name in QueryName]: NonNullable<QueryData<Name>> extends { readonly trace: TraceNode }
    ? Name
    : never;
}[QueryName];
