/**
 * Trace kinds with limits of their own (AIP5-06).
 *
 * The trace store holds every kind to `sim.traceRetentionPerKind` full traces and
 * `sim.traceBytesPerKind` characters. A kind whose detail is meant to last a number of days (rival
 * results: the owner's 28 days of `history.keepDetailDays`, after which `aip.pruneCardDetail`
 * demotes it) can need more than that on a busy world, so a system registers the limits for its
 * kinds here, read from its own tunables. The engine builds its store limits with
 * {@link engineTraceStoreLimits}, which adds them as the store's `perKind` limits.
 *
 * See docs/design/calculation-traces.md#retention.
 */

import { RegistryError } from '../core/errors';
import {
  traceStoreLimitsFrom,
  type TraceKindLimits,
  type TraceStoreLimits,
} from '../core/trace/store';
import type { EngineTunables } from './tunables';

/** One system's kinds and how their limits are read. */
export interface TraceKindLimitSource {
  /** Unique across sources. */
  readonly id: string;
  /** The trace kinds these limits apply to, each on its own. */
  readonly kinds: readonly string[];
  readonly limits: (tunables: EngineTunables) => TraceKindLimits;
}

const sources = new Map<string, TraceKindLimitSource>();

/**
 * Registers limits for some trace kinds. Returns a function that removes them again (for tests).
 *
 * @throws RegistryError when the id is taken or one of the kinds already has limits.
 */
export function registerTraceKindLimits(source: TraceKindLimitSource): () => void {
  if (sources.has(source.id)) {
    throw new RegistryError(`Trace kind limits "${source.id}" are already registered`, {
      sourceId: source.id,
    });
  }
  for (const other of sources.values()) {
    const shared = source.kinds.find((kind) => other.kinds.includes(kind));
    if (shared !== undefined) {
      throw new RegistryError(
        `Trace kind limits "${source.id}": "${other.id}" already sets the limits of ${shared}`,
        { sourceId: source.id, kind: shared },
      );
    }
  }
  const stored: TraceKindLimitSource = Object.freeze({
    id: source.id,
    kinds: [...source.kinds],
    limits: source.limits,
  });
  sources.set(source.id, stored);
  return () => {
    if (sources.get(source.id) === stored) {
      sources.delete(source.id);
    }
  };
}

/** Every registered kind's limits under these tunables. */
export function traceKindLimitsFrom(tunables: EngineTunables): Record<string, TraceKindLimits> {
  const perKind: Record<string, TraceKindLimits> = {};
  for (const source of sources.values()) {
    const limits = source.limits(tunables);
    for (const kind of source.kinds) {
      perKind[kind] = limits;
    }
  }
  return perKind;
}

/** The engine's trace store limits: the `sim.*` tunables plus every registered kind's own. */
export function engineTraceStoreLimits(tunables: EngineTunables): TraceStoreLimits {
  const perKind = traceKindLimitsFrom(tunables);
  return traceStoreLimitsFrom(tunables, Object.keys(perKind).length === 0 ? undefined : perKind);
}
