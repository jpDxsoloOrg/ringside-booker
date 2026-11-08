/**
 * Weighted name tables: exactly proportional picks from long name lists.
 *
 * A table stores the running total of the weights (integer prefix sums in a `Uint32Array`). A pick
 * draws one whole number from 1 to the total with `intBetween` and binary-searches for the first
 * prefix sum that reaches it, so a name with weight `w` comes up with odds exactly `w / total`.
 * Every pick consumes the draws of one `intBetween` call, whatever the list, which keeps the stream
 * aligned when a list grows.
 *
 * `weightedPick` from core/rng walks its list once per pick, which is fine for the short lists
 * (country mixes, ring name patterns) but slow for name lists with hundreds of entries. Tables are
 * built once per list when the generator first sees a content library.
 *
 * Design: docs/design/names.md#weighted-picks.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { intBetween, type RngStream } from '../../../core/rng';
import type { WeightedName } from '../../../persistence/packs/records/names';

/** A list of names with the running total of their weights. */
export interface WeightedTable {
  readonly names: readonly string[];
  /** `prefixSums[i]` is the sum of the weights of names `0..i`. */
  readonly prefixSums: Uint32Array;
  /** The sum of every weight; also the last prefix sum. */
  readonly total: number;
}

/** The name a table pick chose, with its weight and the table's total (its odds are the ratio). */
export interface TablePick {
  readonly name: string;
  readonly weight: number;
  readonly total: number;
}

/** The largest total a table may reach: `intBetween` and the `Uint32Array` both hold 2^32 − 1. */
const MAX_TOTAL = 0xffffffff;

/**
 * Builds a table from `[name, weight]` pairs. Weights must be whole numbers of 1 or more, and the
 * list must not be empty.
 *
 * @throws InvalidArgumentError on an empty list, a bad weight or a total above 2^32 − 1.
 */
export function buildWeightedTable(entries: readonly WeightedName[]): WeightedTable {
  if (entries.length === 0) {
    throw new InvalidArgumentError('buildWeightedTable', 'entries', '[]', 'a non-empty list');
  }
  const prefixSums = new Uint32Array(entries.length);
  const names: string[] = [];
  let total = 0;
  entries.forEach(([name, weight], index) => {
    if (!Number.isSafeInteger(weight) || weight < 1) {
      throw new InvalidArgumentError(
        'buildWeightedTable',
        `entries[${String(index)}] weight`,
        weight,
        'a whole number of 1 or more',
      );
    }
    total += weight;
    if (total > MAX_TOTAL) {
      throw new InvalidArgumentError(
        'buildWeightedTable',
        'total weight',
        total,
        `at most ${String(MAX_TOTAL)}`,
      );
    }
    prefixSums[index] = total;
    names.push(name);
  });
  return { names, prefixSums, total };
}

/** The index of the first prefix sum that is at least `target` (1 ≤ target ≤ total). */
function firstIndexReaching(prefixSums: Uint32Array, target: number): number {
  let low = 0;
  let high = prefixSums.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((prefixSums[middle] ?? 0) >= target) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * Picks one name with odds `weight / total`, and says which weight it had. Consumes the draws of
 * one `intBetween(stream, 1, total)` call.
 */
export function pickTableEntry(stream: RngStream, table: WeightedTable): TablePick {
  const target = intBetween(stream, 1, table.total);
  const index = firstIndexReaching(table.prefixSums, target);
  const reached = table.prefixSums[index] ?? 0;
  const before = index === 0 ? 0 : (table.prefixSums[index - 1] ?? 0);
  return { name: table.names[index] ?? '', weight: reached - before, total: table.total };
}

/** Picks one name with odds `weight / total`. See {@link pickTableEntry}. */
export function pickFromTable(stream: RngStream, table: WeightedTable): string {
  return pickTableEntry(stream, table).name;
}
