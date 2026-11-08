/**
 * The world hash: one short fingerprint of a whole running game.
 *
 * Two runs that start from the same state and make the same choices must end with the same
 * {@link worldHash}. The headless runner prints it and compares two runs with it, so a change that
 * makes the simulation nondeterministic is caught in CI, and a bug report can say "seed 7, 400 days,
 * hash a1b2..." instead of attaching a save.
 *
 * It lives here rather than in `core/hash.ts` so the hash module never imports API types.
 */

import { hashString32, stableStringify } from '../hash';
import { assertJsonValue, isJsonArray, type JsonObject, type JsonValue } from '../json';
import type { EngineState } from './state';

/** Prefix of the second hash pass, so its 32 bits are independent of the first pass. */
const SECOND_PASS_SALT = 'world-hash\u0000second-pass\u0000';

/**
 * A 64-bit hex fingerprint (16 lowercase hex digits) of everything in `state` except what differs
 * between two identical runs: every `timing` field (host wall-clock time) and the `stack` of every
 * serialised error (it depends on where the code was called from).
 *
 * Built from two {@link hashString32} passes over the {@link stableStringify} text, the second one
 * salted, so key order never matters. Not a cryptographic hash. Throws `NotSerialisableError` when
 * the state is not plain JSON.
 */
export function worldHash(state: EngineState): string {
  const plainState: unknown = state;
  assertJsonValue(plainState, 'state');
  const text = stableStringify(withoutRunNoise(plainState));
  return `${toHex32(hashString32(text))}${toHex32(hashString32(`${SECOND_PASS_SALT}${text}`))}`;
}

function toHex32(word: number): string {
  return word.toString(16).padStart(8, '0');
}

/** A serialised error: `name` and `message` strings, plus an optional `stack`. */
function isSerializedErrorShape(value: JsonObject): boolean {
  return typeof value['name'] === 'string' && typeof value['message'] === 'string';
}

/** A copy of `value` with every `timing` key and every serialised error's `stack` left out. */
function withoutRunNoise(value: JsonValue): JsonValue {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isJsonArray(value)) {
    return value.map((entry) => withoutRunNoise(entry));
  }
  const dropStack = isSerializedErrorShape(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'timing' && !(dropStack && key === 'stack'))
      .map(([key, entry]): [string, JsonValue] => [key, withoutRunNoise(entry)]),
  );
}
