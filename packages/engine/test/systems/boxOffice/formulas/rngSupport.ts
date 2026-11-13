// Shared helpers for the box office formula tests: seeded streams that count their draws.
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import {
  BOX_OFFICE_CROWD_STREAM,
  BOX_OFFICE_MERCH_STREAM,
} from '../../../../src/systems/boxOffice';

/** A stream that counts how many numbers were drawn from it. */
export interface CountingStream extends RngStream {
  readonly draws: number;
}

function counting(inner: RngStream): CountingStream {
  let draws = 0;
  return {
    name: inner.name,
    get draws() {
      return draws;
    },
    nextUint32() {
      draws += 1;
      return inner.nextUint32();
    },
    nextFloat() {
      draws += 1;
      return inner.nextFloat();
    },
  };
}

export function crowdStream(seed: string): CountingStream {
  return counting(new RngRegistry(seed).stream(BOX_OFFICE_CROWD_STREAM));
}

export function merchStream(seed: string): CountingStream {
  return counting(new RngRegistry(seed).stream(BOX_OFFICE_MERCH_STREAM));
}
