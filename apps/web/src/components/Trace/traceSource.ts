import type { TraceNode, TraceRef } from '@ringside/engine';

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
