/**
 * The engine's pseudo-random generator: an sfc32-style small fast counting generator.
 *
 * - 128 bits of state held as four unsigned 32-bit words, so the state fits in JSON with no
 *   precision loss and needs no BigInt.
 * - The step uses integer operations only (`+` on uint32 values with wrap, xor, shifts), so the
 *   sequence is bit-identical in every JavaScript engine.
 * - The fourth word is a counter, so the generator never falls into a fixed point and its period
 *   is at least 2^32 for any state.
 *
 * FROZEN OUTPUT: the step, the seeding and the warm-up count are part of the save format. Golden
 * tests in `test/core/rng/prng.test.ts` fail if any of them change.
 */

import { hashString128 } from '../hash';

/** The generator state: four unsigned 32-bit words, in the order the generator uses them. */
export type RngStateWords = [number, number, number, number];

/** How many outputs are thrown away after seeding so near-identical seeds diverge. */
export const WARM_UP_DRAWS = 12;

/** Word substituted for the first word when a seed hashes to the all-zero state. */
const ZERO_STATE_SUBSTITUTE = 0x9e3779b9;

/** 2^32, the divisor that turns a uint32 into a float in [0, 1). */
const UINT32_RANGE = 0x100000000;

const STATE_WORD_COUNT = 4;

/** An sfc32-style generator over a `Uint32Array(4)`. Writes to the array wrap modulo 2^32. */
export class Sfc32 {
  readonly #state: Uint32Array;

  /** Starts the generator from an exact state (no warm-up). Use {@link seedState} for seeds. */
  constructor(stateWords: Readonly<RngStateWords>) {
    this.#state = new Uint32Array(STATE_WORD_COUNT);
    this.setState(stateWords);
  }

  /** Returns the next output as an unsigned 32-bit integer in [0, 2^32 - 1]. */
  nextUint32(): number {
    const state = this.#state;
    const wordA = state[0] ?? 0;
    const wordB = state[1] ?? 0;
    const wordC = state[2] ?? 0;
    const counter = state[3] ?? 0;
    // Standard sfc32 order: the output adds the counter's current value, then the counter steps.
    const output = (((wordA + wordB) >>> 0) + counter) >>> 0;

    state[0] = wordB ^ (wordB >>> 9);
    state[1] = wordC + (wordC << 3);
    state[2] = ((wordC << 21) | (wordC >>> 11)) + output;
    state[3] = counter + 1;
    return output;
  }

  /** Returns the next output as a float in [0, 1): `nextUint32() / 2^32`. Never returns 1. */
  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /** Returns a copy of the current state. */
  getState(): RngStateWords {
    const state = this.#state;
    return [state[0] ?? 0, state[1] ?? 0, state[2] ?? 0, state[3] ?? 0];
  }

  /** Replaces the current state with a copy of the given words. */
  setState(stateWords: Readonly<RngStateWords>): void {
    this.#state[0] = stateWords[0];
    this.#state[1] = stateWords[1];
    this.#state[2] = stateWords[2];
    this.#state[3] = stateWords[3];
  }
}

/**
 * Replaces an all-zero state with a fixed non-zero one. Any other state is returned unchanged.
 *
 * sfc32's counter word keeps even the zero state moving, but a state of four zeros starts with
 * several tiny, predictable outputs, so it is never used as a starting state.
 */
export function guardZeroState(stateWords: Readonly<RngStateWords>): RngStateWords {
  const [wordA, wordB, wordC, wordD] = stateWords;
  if (wordA === 0 && wordB === 0 && wordC === 0 && wordD === 0) {
    return [ZERO_STATE_SUBSTITUTE, 0, 0, 0];
  }
  return [wordA, wordB, wordC, wordD];
}

/**
 * Derives the starting state of one named stream from the game seed.
 *
 * The state is `hashString128(seed + "\u0000" + streamName)`, guarded against all zeros, then
 * stepped {@link WARM_UP_DRAWS} times. The NUL separator cannot appear in a stream name, so two
 * different (seed, name) pairs never produce the same hash input.
 */
export function seedState(seed: string, streamName: string): RngStateWords {
  const generator = new Sfc32(guardZeroState(hashString128(`${seed}\u0000${streamName}`)));
  for (let draw = 0; draw < WARM_UP_DRAWS; draw++) {
    generator.nextUint32();
  }
  return generator.getState();
}
