/**
 * Per-phase timing for profiling (POL4-12): how long each day phase and each event reaction took
 * over a run, summed by step id. Off unless a benchmark turns it on, and then it only reads the
 * clock it was given, so the simulation never sees it and results cannot change.
 *
 * Module state, on purpose (like `core/fastPaths.ts`): a benchmark harness turns it on around one
 * run and reads the map back.
 */

/** The summed time of one step id. */
export interface PhaseTimingEntry {
  /** Milliseconds spent in the step's own body (a phase's `run` or a reaction). */
  readonly ms: number;
  /** How many times it ran. */
  readonly calls: number;
}

let clock: (() => number) | null = null;
const totals = new Map<string, { ms: number; calls: number }>();

/** Starts timing with `now` as the clock, clearing what was timed before. */
export function startPhaseTiming(now: () => number): void {
  clock = now;
  totals.clear();
}

/** Stops timing and returns the totals, slowest first. */
export function stopPhaseTiming(): Array<{ readonly id: string } & PhaseTimingEntry> {
  clock = null;
  const entries = [...totals.entries()].map(([id, entry]) => ({ id, ...entry }));
  totals.clear();
  return entries.sort((left, right) => right.ms - left.ms);
}

/** Runs `body`, adding its time to `id` when timing is on. */
export function timed<T>(id: string, body: () => T): T {
  const now = clock;
  if (now === null) return body();
  const startedAt = now();
  try {
    return body();
  } finally {
    const entry = totals.get(id);
    const ms = now() - startedAt;
    if (entry === undefined) totals.set(id, { ms, calls: 1 });
    else {
      entry.ms += ms;
      entry.calls += 1;
    }
  }
}
