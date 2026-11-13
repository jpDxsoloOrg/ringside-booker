import type { QueryData, QueryName, TraceNode, TraceRef } from '@ringside/engine';

/** Where a panel gets its trace: handed over inline, or fetched from the engine by reference. */
export type TraceSource = { readonly trace: TraceNode } | { readonly traceRef: TraceRef };

/** The source for an optional inline trace or reference, or null when there is neither. */
export function traceSourceOf(
  trace: TraceNode | null | undefined,
  traceRef: TraceRef | null | undefined,
): TraceSource | null {
  if (trace !== undefined && trace !== null) return { trace };
  if (traceRef !== undefined && traceRef !== null) return { traceRef };
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
