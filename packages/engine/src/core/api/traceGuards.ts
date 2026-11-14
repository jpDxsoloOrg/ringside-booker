/**
 * Read guards for stored traces (ECO5-05). `trace.get` hands any stored trace to whoever asks for
 * its ref, which is fine for most kinds (a rival's results are kept as summaries only). A system
 * whose traces mix several promotions' private numbers registers a guard for its kind: the guard
 * sees the viewer and the stored entry and returns what that viewer may see (the entry, a redacted
 * copy, or null for "not yours").
 *
 * Design: docs/design/calculation-traces.md and docs/design/negotiation.md#review.
 */

import { RegistryError } from '../errors';
import type { StoredTraceEntry } from '../trace/store';
import type { QueryContext } from './query';

/** What a viewer may see of one stored trace of a guarded kind. */
export type TraceReadGuard = (
  ctx: QueryContext,
  entry: StoredTraceEntry,
) => StoredTraceEntry | null;

const guards = new Map<string, TraceReadGuard>();

/**
 * Guards every trace of `kind`. Returns a function that removes the guard again.
 *
 * @throws RegistryError when the kind already has a guard.
 */
export function registerTraceReadGuard(kind: string, guard: TraceReadGuard): () => void {
  if (guards.has(kind)) {
    throw new RegistryError(`Trace kind "${kind}" already has a read guard`, { kind });
  }
  guards.set(kind, guard);
  return () => {
    if (guards.get(kind) === guard) {
      guards.delete(kind);
    }
  };
}

/** The entry as `ctx.viewer` may see it: unchanged for unguarded kinds. */
export function guardTraceRead(
  ctx: QueryContext,
  entry: StoredTraceEntry | undefined,
): StoredTraceEntry | null {
  if (entry === undefined) {
    return null;
  }
  const guard = guards.get(entry.ref.kind);
  return guard === undefined ? entry : guard(ctx, entry);
}
