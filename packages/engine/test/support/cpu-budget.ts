/**
 * CPU-time budgets for speed guards that hold up on a busy machine.
 *
 * A fixed millisecond bound fails when the machine is loaded: other processes share the cores'
 * caches and hyperthreads and lower the clock, so the same work costs more CPU time. Here the work
 * is timed against a reference workload measured in the same process, just before and just after
 * it, so both are slowed alike and the ratio between them holds. The reference is plain
 * JavaScript that never touches the engine, so an engine slowdown cannot hide by slowing it too.
 */

/** CPU time (user and system) in ms that `run` takes in this process. */
export function cpuMs(run: () => void): number {
  const started = process.cpuUsage();
  run();
  const used = process.cpuUsage(started);
  return (used.user + used.system) / 1000;
}

/** Rows the reference workload builds, about 50 ms of CPU time alone on a laptop. */
const REFERENCE_ROWS = 60_000;

/**
 * The reference workload: what the engine spends its time on, without the engine. It builds rows
 * of small objects, indexes them in a Map, sorts them and folds them into a checksum, from a fixed
 * seed so every call does the same work.
 */
function referenceWorkload(): number {
  let seed = 12_345;
  const next = (): number => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return seed / 4_294_967_296;
  };
  const rows: { id: string; score: number; parts: number[] }[] = [];
  const byId = new Map<string, { id: string; score: number; parts: number[] }>();
  for (let index = 0; index < REFERENCE_ROWS; index++) {
    const row = {
      id: `row-${String(index)}`,
      score: next() * 100,
      parts: [next(), next(), next(), next()],
    };
    rows.push(row);
    byId.set(row.id, row);
  }
  rows.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
  let checksum = 0;
  for (const row of rows) {
    const found = byId.get(row.id);
    if (found === undefined) continue;
    checksum += found.parts.reduce((sum, part) => sum + Math.sqrt(part * found.score), 0);
  }
  return checksum;
}

/** CPU time in ms of one run of the reference workload, the best of `rounds`. */
export function referenceCpuMs(rounds = 3): number {
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round++) {
    let checksum = 0;
    const used = cpuMs(() => {
      checksum = referenceWorkload();
    });
    if (!Number.isFinite(checksum)) throw new Error('The reference workload lost its checksum.');
    best = Math.min(best, used);
  }
  return best;
}

export interface CpuBudgetResult {
  /** CPU time of the work, in ms. */
  readonly workMs: number;
  /** CPU time of the reference workload measured around it (the mean of before and after), in ms. */
  readonly referenceMs: number;
  /** How many reference workloads the work cost. */
  readonly ratio: number;
}

/**
 * Times `run` against the reference workload measured right before and right after it, so a
 * machine that gets busier or quieter during the run moves both.
 */
export function measureAgainstReference(run: () => void): CpuBudgetResult {
  referenceWorkload();
  const before = referenceCpuMs();
  const workMs = cpuMs(run);
  const after = referenceCpuMs();
  const referenceMs = (before + after) / 2;
  return { workMs, referenceMs, ratio: workMs / referenceMs };
}
