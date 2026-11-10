/**
 * Stable string hashing for seeds and RNG stream derivation.
 *
 * FROZEN OUTPUT: saves store a seed string and the engine re-derives every untouched RNG stream
 * from it on load. If these functions ever return something different for the same input, every
 * existing save quietly plays out a different future. Golden-value tests in
 * `test/core/hash.test.ts` lock the output. A change here needs a save migration that re-seeds.
 *
 * The mixer is a cyrb128-style hash: four 32-bit lanes, each fed every UTF-16 code unit of the
 * input, then cross-mixed. Only integer operations are used (`Math.imul`, xor, shifts, `>>> 0`),
 * so the result is identical in every JavaScript engine. It is not a cryptographic hash.
 */

import { assertJsonValue, isJsonArray, type JsonValue } from './json';

/** Four unsigned 32-bit words. */
export type HashWords = [number, number, number, number];

const LANE_ONE_INIT = 0x6a09e667;
const LANE_TWO_INIT = 0xbb67ae85;
const LANE_THREE_INIT = 0x3c6ef372;
const LANE_FOUR_INIT = 0xa54ff53a;

const LANE_ONE_MULTIPLIER = 0x239b961b;
const LANE_TWO_MULTIPLIER = 0xab0e9789;
const LANE_THREE_MULTIPLIER = 0x38b34ae5;
const LANE_FOUR_MULTIPLIER = 0xa1e38b93;

/**
 * Hashes a string to four unsigned 32-bit words.
 *
 * The input is read as UTF-16 code units (`charCodeAt`), so any string, including one with
 * unpaired surrogates, hashes the same way everywhere.
 */
export function hashString128(input: string): HashWords {
  let laneOne = LANE_ONE_INIT;
  let laneTwo = LANE_TWO_INIT;
  let laneThree = LANE_THREE_INIT;
  let laneFour = LANE_FOUR_INIT;

  for (let index = 0; index < input.length; index++) {
    const codeUnit = input.charCodeAt(index);
    laneOne = laneTwo ^ Math.imul(laneOne ^ codeUnit, LANE_ONE_MULTIPLIER);
    laneTwo = laneThree ^ Math.imul(laneTwo ^ codeUnit, LANE_TWO_MULTIPLIER);
    laneThree = laneFour ^ Math.imul(laneThree ^ codeUnit, LANE_THREE_MULTIPLIER);
    laneFour = laneOne ^ Math.imul(laneFour ^ codeUnit, LANE_FOUR_MULTIPLIER);
  }

  laneOne = Math.imul(laneThree ^ (laneOne >>> 18), LANE_ONE_MULTIPLIER);
  laneTwo = Math.imul(laneFour ^ (laneTwo >>> 22), LANE_TWO_MULTIPLIER);
  laneThree = Math.imul(laneOne ^ (laneThree >>> 17), LANE_THREE_MULTIPLIER);
  laneFour = Math.imul(laneTwo ^ (laneFour >>> 19), LANE_FOUR_MULTIPLIER);

  laneOne ^= laneTwo ^ laneThree ^ laneFour;
  laneTwo ^= laneOne;
  laneThree ^= laneOne;
  laneFour ^= laneOne;

  return [laneOne >>> 0, laneTwo >>> 0, laneThree >>> 0, laneFour >>> 0];
}

const HEX_DIGITS_PER_WORD = 8;

/** Four hash words as 32 lowercase hex characters, first word first. */
export function hashWordsToHex(words: HashWords): string {
  return words.map((word) => word.toString(16).padStart(HEX_DIGITS_PER_WORD, '0')).join('');
}

/**
 * Hashes a string to one unsigned 32-bit word: the first word of {@link hashString128}.
 *
 * Shares the frozen-output rule of `hashString128`.
 */
export function hashString32(input: string): number {
  return hashString128(input)[0];
}

/**
 * Serialises a JSON value with every object's keys in sorted order (by UTF-16 code unit, the
 * default `Array.prototype.sort` order) and array entries in their own order, so two values that
 * hold the same data always give the same text, however their keys were inserted.
 *
 * Throws `NotSerialisableError` naming the first bad path for anything that is not plain JSON (a
 * `Map`, `undefined`, `NaN`, a class instance, a cycle, ...), using the engine's one check,
 * {@link assertJsonValue}. `-0` is written as `0`, as `JSON.stringify` does.
 *
 * Not frozen like the hashes above: nothing stored in a save depends on this text. The world hash
 * (`worldHash`) is built on it, so a change here only changes hashes printed by the tools.
 */
export function stableStringify(value: unknown): string {
  assertJsonValue(value);
  return stringifySorted(value);
}

function stringifySorted(value: JsonValue): string {
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map((entry) => stringifySorted(entry)).join(',')}]`;
  }
  const members = Object.entries(value)
    .sort(([leftKey], [rightKey]) => compareCodeUnits(leftKey, rightKey))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stringifySorted(entry)}`);
  return `{${members.join(',')}}`;
}

/** Orders two strings by UTF-16 code unit, independent of locale. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
