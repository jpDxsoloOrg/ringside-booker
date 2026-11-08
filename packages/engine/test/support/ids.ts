import type { IdEntropy } from '../../src/core/ids';

/** Values per 25-bit half of an ID body. */
const HALF_RANGE = 2 ** 25;
/** The factory keeps the top 25 bits of each draw, so a half is shifted up past the low 7 bits. */
const HALF_SHIFT_MULTIPLIER = 2 ** 7;

/**
 * Test-only entropy that makes the ID factory mint readable, predictable IDs: the first ID body is
 * `start` in base32 (`0000000001` by default), the next is `start + 1`, and so on.
 *
 * The factory draws two numbers per ID and keeps the top 25 bits of each, so this yields the high
 * and low 25-bit halves of a counter in turn.
 */
export function sequentialIdEntropy(start = 1): IdEntropy {
  let counter = start;
  let pendingLowHalf: number | null = null;
  return {
    nextUint32(): number {
      if (pendingLowHalf !== null) {
        const lowHalf = pendingLowHalf;
        pendingLowHalf = null;
        counter += 1;
        return lowHalf * HALF_SHIFT_MULTIPLIER;
      }
      pendingLowHalf = counter % HALF_RANGE;
      return Math.floor(counter / HALF_RANGE) * HALF_SHIFT_MULTIPLIER;
    },
  };
}

/** Test-only entropy that replays a fixed list of draws, then throws if asked for more. */
export function scriptedIdEntropy(draws: readonly number[]): IdEntropy & { readonly used: number } {
  let index = 0;
  return {
    get used(): number {
      return index;
    },
    nextUint32(): number {
      const draw = draws[index];
      if (draw === undefined) {
        throw new Error(`scriptedIdEntropy ran out of draws after ${String(draws.length)}`);
      }
      index += 1;
      return draw;
    },
  };
}
