/**
 * Recorded rolls: the odds helpers in a form that also returns a {@link RollRecord}, so a
 * calculation trace can show every roll with its odds and result.
 *
 * Each recorded helper calls the plain helper from `./odds` and only adds the record, so it
 * consumes exactly the same draws. Switching a call site between `chance` and `rollChance` never
 * changes a result.
 */

import {
  chance,
  floatBetween,
  intBetween,
  normal,
  oneIn,
  pick,
  weightedPickEntry,
  type WeightedEntry,
} from './odds';
import type { RngStream } from './registry';

/** What kind of roll a {@link RollRecord} describes. */
export type RollKind = 'chance' | 'oneIn' | 'int' | 'float' | 'pick' | 'weighted' | 'normal';

/**
 * One random roll, as shown in a calculation trace. Every field is JSON-safe: strings, booleans
 * and finite numbers only, so a record survives `JSON.stringify` and a save round trip unchanged.
 */
export interface RollRecord {
  /** The stream the roll drew from. */
  stream: string;
  kind: RollKind;
  /** What the roll decided, in words (for example "Injury check"). */
  label: string;
  /** Probability of the result that came up, where it is known exactly. */
  odds?: number;
  /** Lower end of the range: included for `int` and `float`, the clamp floor elsewhere. */
  min?: number;
  /** Upper end of the range: included for `int`, excluded for `float`. */
  max?: number;
  /** How many equally likely or weighted options there were. */
  options?: number;
  /** The outcome: a boolean for checks, a number for ranges, a description for picks. */
  result: number | boolean | string;
}

/** A helper's value together with the record of the roll that produced it. */
export interface RecordedRoll<T> {
  value: T;
  roll: RollRecord;
}

/** `chance(stream, probability)` with a record: `odds` is the probability, `result` the outcome. */
export function rollChance(
  stream: RngStream,
  probability: number,
  label: string,
): RecordedRoll<boolean> {
  const value = chance(stream, probability);
  return {
    value,
    roll: { stream: stream.name, kind: 'chance', label, odds: probability, result: value },
  };
}

/** `intBetween(stream, min, max)` with a record: both ends, the odds `1 / span` and the result. */
export function rollInt(
  stream: RngStream,
  min: number,
  max: number,
  label: string,
): RecordedRoll<number> {
  const value = intBetween(stream, min, max);
  return {
    value,
    roll: {
      stream: stream.name,
      kind: 'int',
      label,
      odds: 1 / (max - min + 1),
      min,
      max,
      result: value,
    },
  };
}

/** `oneIn(stream, count)` with a record: `odds` is `1 / count` and `options` is `count`. */
export function rollOneIn(stream: RngStream, count: number, label: string): RecordedRoll<boolean> {
  const value = oneIn(stream, count);
  return {
    value,
    roll: {
      stream: stream.name,
      kind: 'oneIn',
      label,
      odds: 1 / count,
      options: count,
      result: value,
    },
  };
}

/** `floatBetween(stream, min, max)` with a record: `min` included, `max` excluded. */
export function rollFloat(
  stream: RngStream,
  min: number,
  max: number,
  label: string,
): RecordedRoll<number> {
  const value = floatBetween(stream, min, max);
  return { value, roll: { stream: stream.name, kind: 'float', label, min, max, result: value } };
}

/** `normal(stream, mean, sd)` with a record of the result. A continuous value has no exact odds. */
export function rollNormal(
  stream: RngStream,
  mean: number,
  sd: number,
  label: string,
): RecordedRoll<number> {
  const value = normal(stream, mean, sd);
  return { value, roll: { stream: stream.name, kind: 'normal', label, result: value } };
}

/**
 * `pick(stream, items)` with a record: `options` is the list length, `odds` is `1 / length`, and
 * `result` is `describe(item)` so the record holds a readable string rather than the item.
 */
export function rollPick<T>(
  stream: RngStream,
  items: readonly T[],
  label: string,
  describe: (item: T) => string,
): RecordedRoll<T> {
  const value = pick(stream, items);
  return {
    value,
    roll: {
      stream: stream.name,
      kind: 'pick',
      label,
      odds: 1 / items.length,
      options: items.length,
      result: describe(value),
    },
  };
}

/**
 * `weightedPick(stream, entries)` with a record: `options` is the number of entries, `odds` is the
 * chosen entry's `weight / totalWeight`, and `result` is `describe(item)`.
 */
export function rollWeighted<T>(
  stream: RngStream,
  entries: readonly WeightedEntry<T>[],
  label: string,
  describe: (item: T) => string,
): RecordedRoll<T> {
  const chosen = weightedPickEntry(stream, entries);
  return {
    value: chosen.item,
    roll: {
      stream: stream.name,
      kind: 'weighted',
      label,
      odds: chosen.weight / chosen.totalWeight,
      options: entries.length,
      result: describe(chosen.item),
    },
  };
}
