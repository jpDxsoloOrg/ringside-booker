/**
 * Odds and sampling helpers on top of an {@link RngStream}.
 *
 * Every helper states its odds exactly and checks its arguments: reversed bounds, non-integer
 * integer bounds, probabilities outside [0, 1], empty lists and bad weights all throw an
 * {@link InvalidOddsError} (an `EngineError`) naming the bad value. Nothing is silently clamped or
 * swapped.
 *
 * Draw counts are part of the contract. Each helper consumes the same number of draws whatever
 * its arguments (the only exceptions are the rejection loop in {@link intBetween} and the
 * `u1 === 0` redraw in {@link normal}, both vanishingly rare), so tuning one probability never
 * shifts the rest of the stream.
 *
 * See the "Odds helpers" section of `docs/design/determinism.md` for the full table.
 */

import { InvalidOddsError } from '../errors';
import type { RngStream } from './registry';

/** 2^32: the number of distinct values `nextUint32()` can return. */
const UINT32_RANGE = 0x1_0000_0000;

/** Describes a number for an error message, keeping `-0`, `NaN` and infinities readable. */
function formatNumber(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value);
}

function assertFiniteNumber(functionName: string, argumentName: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidOddsError(
      functionName,
      `${argumentName} must be a finite number, got ${formatNumber(value)}`,
      { argumentName, value: formatNumber(value) },
    );
  }
}

function assertSafeInteger(functionName: string, argumentName: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidOddsError(
      functionName,
      `${argumentName} must be a whole number, got ${formatNumber(value)}`,
      { argumentName, value: formatNumber(value) },
    );
  }
}

function assertProbability(functionName: string, argumentName: string, value: number): void {
  assertFiniteNumber(functionName, argumentName, value);
  if (value < 0 || value > 1) {
    throw new InvalidOddsError(
      functionName,
      `${argumentName} must be between 0 and 1, got ${formatNumber(value)}`,
      { argumentName, value: formatNumber(value) },
    );
  }
}

function assertOrderedBounds(functionName: string, min: number, max: number): void {
  if (min > max) {
    throw new InvalidOddsError(
      functionName,
      `min (${formatNumber(min)}) must not be greater than max (${formatNumber(max)})`,
      { min: formatNumber(min), max: formatNumber(max) },
    );
  }
}

/**
 * Type guard for an array element read with `noUncheckedIndexedAccess`: an index inside the
 * array's bounds holds a real element, even when the element type itself allows `undefined`.
 */
function isElement<T>(items: readonly T[], index: number, element: T | undefined): element is T {
  return element !== undefined || (index >= 0 && index < items.length);
}

function elementAt<T>(items: readonly T[], index: number): T {
  const element = items[index];
  if (!isElement(items, index, element)) {
    throw new InvalidOddsError(
      'elementAt',
      `index ${String(index)} is outside a list of ${String(items.length)}`,
      { index, length: items.length },
    );
  }
  return element;
}

/**
 * True with the given probability, stated exactly as `Math.round(probability * 2^32) / 2^32`.
 *
 * Always consumes exactly one draw, including for a probability of 0 (always false) and 1 (always
 * true), so changing a probability never changes how far the stream moves.
 *
 * @throws InvalidOddsError when `probability` is not a finite number in [0, 1].
 */
export function chance(stream: RngStream, probability: number): boolean {
  assertProbability('chance', 'probability', probability);
  const draw = stream.nextUint32();
  if (probability === 1) {
    return true;
  }
  return draw < Math.round(probability * UINT32_RANGE);
}

/**
 * True with probability `k` percent: exactly `chance(stream, k / 100)`, draw for draw.
 *
 * @throws InvalidOddsError when `k` is not a finite number in [0, 100].
 */
export function percent(stream: RngStream, k: number): boolean {
  assertFiniteNumber('percent', 'k', k);
  if (k < 0 || k > 100) {
    throw new InvalidOddsError('percent', `k must be between 0 and 100, got ${formatNumber(k)}`, {
      argumentName: 'k',
      value: formatNumber(k),
    });
  }
  return chance(stream, k / 100);
}

/**
 * A uniformly random whole number from `min` to `max`, **both ends included**.
 *
 * Unbiased: a draw from the top `2^32 mod span` values is rejected and redrawn, so every value
 * has exactly the same odds (`1 / span`). The redraw loop runs with probability below
 * `span / 2^32` per call. `min === max` still consumes one draw.
 *
 * @throws InvalidOddsError when either bound is not a whole number, when `min > max`, or when the
 *   range holds more than 2^32 values.
 */
export function intBetween(stream: RngStream, min: number, max: number): number {
  assertSafeInteger('intBetween', 'min', min);
  assertSafeInteger('intBetween', 'max', max);
  assertOrderedBounds('intBetween', min, max);
  const span = max - min + 1;
  if (span > UINT32_RANGE) {
    throw new InvalidOddsError(
      'intBetween',
      `the range ${formatNumber(min)}..${formatNumber(max)} holds ${String(span)} values; ` +
        `at most 2^32 are supported`,
      { min: formatNumber(min), max: formatNumber(max) },
    );
  }
  const acceptLimit = UINT32_RANGE - (UINT32_RANGE % span);
  for (;;) {
    const draw = stream.nextUint32();
    if (draw < acceptLimit) {
      return min + (draw % span);
    }
  }
}

/**
 * True with probability exactly `1 / count`: `intBetween(stream, 1, count) === 1`.
 *
 * This is the one way to write a "1 in N" check. Rolling 0..N and comparing with 1 looks the same
 * but fires 1 time in N + 1.
 *
 * @throws InvalidOddsError when `count` is not a whole number of at least 1 (or more than 2^32).
 */
export function oneIn(stream: RngStream, count: number): boolean {
  assertSafeInteger('oneIn', 'count', count);
  if (count < 1) {
    throw new InvalidOddsError('oneIn', `count must be at least 1, got ${formatNumber(count)}`, {
      argumentName: 'count',
      value: formatNumber(count),
    });
  }
  return intBetween(stream, 1, count) === 1;
}

/** The largest double strictly below a finite `value`. */
function largestDoubleBelow(value: number): number {
  if (value === 0) {
    return -Number.MIN_VALUE;
  }
  const bitsView = new DataView(new ArrayBuffer(8));
  bitsView.setFloat64(0, value);
  const bits = bitsView.getBigUint64(0);
  // For positive doubles the bit pattern grows with the value; for negative ones it shrinks.
  bitsView.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n);
  return bitsView.getFloat64(0);
}

/**
 * A uniformly random float in `[min, max)`: `min` can come up, `max` never does. `min === max`
 * returns `min`. Consumes one draw.
 *
 * When `min` is so large that `min + fraction * (max - min)` rounds up to `max`, the result is the
 * largest double below `max`, so the upper end stays excluded.
 *
 * @throws InvalidOddsError when either bound is not finite or `min > max`.
 */
export function floatBetween(stream: RngStream, min: number, max: number): number {
  assertFiniteNumber('floatBetween', 'min', min);
  assertFiniteNumber('floatBetween', 'max', max);
  assertOrderedBounds('floatBetween', min, max);
  const width = max - min;
  if (!Number.isFinite(width)) {
    throw new InvalidOddsError(
      'floatBetween',
      `the range ${formatNumber(min)}..${formatNumber(max)} is too wide`,
      { min: formatNumber(min), max: formatNumber(max) },
    );
  }
  const value = min + stream.nextFloat() * width;
  if (min < max && value >= max) {
    return largestDoubleBelow(max);
  }
  return value;
}

/**
 * One item from a non-empty list, each with odds `1 / items.length`. Consumes the draws of one
 * `intBetween(stream, 0, items.length - 1)` call.
 *
 * @throws InvalidOddsError when the list is empty.
 */
export function pick<T>(stream: RngStream, items: readonly T[]): T {
  if (items.length === 0) {
    throw new InvalidOddsError('pick', 'items must not be empty, got an empty list');
  }
  return elementAt(items, intBetween(stream, 0, items.length - 1));
}

/** One option for {@link weightedPick}: an item and its relative weight. */
export interface WeightedEntry<T> {
  readonly item: T;
  readonly weight: number;
}

/** The entry {@link weightedPickEntry} chose, with its position and the total weight. */
export interface WeightedPickResult<T> {
  readonly item: T;
  readonly index: number;
  readonly weight: number;
  readonly totalWeight: number;
}

function assertWeights<T>(functionName: string, entries: readonly WeightedEntry<T>[]): number {
  if (entries.length === 0) {
    throw new InvalidOddsError(functionName, 'entries must not be empty, got an empty list');
  }
  let totalWeight = 0;
  entries.forEach((entry, entryIndex) => {
    const weight = entry.weight;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new InvalidOddsError(
        functionName,
        `entries[${String(entryIndex)}].weight must be a finite number of 0 or more, ` +
          `got ${formatNumber(weight)}`,
        { entryIndex, weight: formatNumber(weight) },
      );
    }
    totalWeight += weight;
  });
  if (!Number.isFinite(totalWeight)) {
    throw new InvalidOddsError(functionName, `the total weight overflows (${String(totalWeight)})`);
  }
  if (totalWeight === 0) {
    throw new InvalidOddsError(functionName, 'the weights must not all be 0');
  }
  return totalWeight;
}

/**
 * Like {@link weightedPick}, but also says which entry was chosen and with what weight. The
 * recorded helpers use it to state the odds of the result. Same validation, same single draw.
 */
export function weightedPickEntry<T>(
  stream: RngStream,
  entries: readonly WeightedEntry<T>[],
): WeightedPickResult<T> {
  const totalWeight = assertWeights('weightedPick', entries);
  const target = stream.nextFloat() * totalWeight;
  let cumulativeWeight = 0;
  let lastPositiveIndex = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = elementAt(entries, index);
    if (entry.weight === 0) {
      continue;
    }
    lastPositiveIndex = index;
    cumulativeWeight += entry.weight;
    if (target < cumulativeWeight) {
      return { item: entry.item, index, weight: entry.weight, totalWeight };
    }
  }
  // Only reachable when float rounding puts the target on the very top of the total: the last
  // entry with a positive weight owns that end, so a zero-weight entry still never comes up.
  const lastEntry = elementAt(entries, lastPositiveIndex);
  return { item: lastEntry.item, index: lastPositiveIndex, weight: lastEntry.weight, totalWeight };
}

/**
 * One item, chosen with odds `weight / totalWeight` (to a resolution of 2^-32). Walks the
 * cumulative weights in the given order with a single `nextFloat()` draw. Zero-weight entries are
 * allowed and never chosen.
 *
 * @throws InvalidOddsError on an empty list, a negative or non-finite weight, or weights that are
 *   all 0.
 */
export function weightedPick<T>(stream: RngStream, entries: readonly WeightedEntry<T>[]): T {
  return weightedPickEntry(stream, entries).item;
}

/**
 * A shuffled copy of `items` (Fisher–Yates, every order equally likely). The input is never
 * changed. Consumes the draws of `items.length - 1` `intBetween` calls; an empty or one-item list
 * consumes none.
 */
export function shuffle<T>(stream: RngStream, items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = intBetween(stream, 0, index);
    const current = elementAt(shuffled, index);
    shuffled[index] = elementAt(shuffled, swapIndex);
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

/**
 * A normally distributed value (Box–Muller). Consumes exactly two `nextFloat()` draws: the first
 * is redrawn while it is 0 (odds 2^-32 per draw), and the spare value Box–Muller produces is
 * thrown away rather than cached, so a call never depends on the one before it.
 *
 * @throws InvalidOddsError when `mean` is not finite or `sd` is not a finite number of 0 or more.
 */
export function normal(stream: RngStream, mean: number, sd: number): number {
  assertFiniteNumber('normal', 'mean', mean);
  assertFiniteNumber('normal', 'sd', sd);
  if (sd < 0) {
    throw new InvalidOddsError('normal', `sd must be 0 or more, got ${formatNumber(sd)}`, {
      argumentName: 'sd',
      value: formatNumber(sd),
    });
  }
  let radiusDraw = stream.nextFloat();
  while (radiusDraw === 0) {
    radiusDraw = stream.nextFloat();
  }
  const angleDraw = stream.nextFloat();
  const standardValue = Math.sqrt(-2 * Math.log(radiusDraw)) * Math.cos(2 * Math.PI * angleDraw);
  return mean + sd * standardValue;
}

/**
 * {@link normal}, then clamped into `[min, max]` (both ends included). Clamping instead of
 * redrawing keeps the draw count at two; the ends collect the clipped tails.
 *
 * @throws InvalidOddsError for a bad `mean` or `sd` (as {@link normal}), non-finite bounds or
 *   `min > max`.
 */
export function clampedNormal(
  stream: RngStream,
  mean: number,
  sd: number,
  min: number,
  max: number,
): number {
  assertFiniteNumber('clampedNormal', 'min', min);
  assertFiniteNumber('clampedNormal', 'max', max);
  assertOrderedBounds('clampedNormal', min, max);
  return Math.min(max, Math.max(min, normal(stream, mean, sd)));
}
