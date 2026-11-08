/**
 * The RNG registry: one seed, many independent named streams.
 *
 * Each stream's starting state is derived from the game seed and the stream's name, so drawing
 * from one stream never moves another. Streams are created lazily the first time a system asks
 * for them. Only touched streams are saved; every other stream re-derives from the seed on load
 * and comes out exactly as it would have if it had been saved.
 *
 * See `docs/design/determinism.md`.
 */

import { z } from 'zod';
import { Sfc32, seedState, type RngStateWords } from './prng';
import { STREAM_NAME_PATTERN, assertStreamName, type StreamName } from './streams';

/**
 * One named random stream. Pass it into pure formula functions: it holds no reference to the
 * registry or the world, only its own generator state.
 */
export interface RngStream {
  /** The stream's name, for traces and error messages. */
  readonly name: StreamName;
  /** Next output as an unsigned 32-bit integer in [0, 2^32 - 1]. */
  nextUint32(): number;
  /** Next output as a float in [0, 1). Never returns 1. */
  nextFloat(): number;
}

/** The serialised RNG state, as stored in a save. */
export interface RngState {
  version: 1;
  /** The game seed every stream is derived from. */
  seed: string;
  /** Current state of every touched stream, keyed by stream name in sorted order. */
  streams: Record<string, RngStateWords>;
}

/**
 * An in-memory copy of the touched streams, taken with {@link RngRegistry.snapshot} and put back
 * with {@link RngRegistry.restore}. Used to roll back a failed step. Not a save format.
 */
export interface RngSnapshot {
  readonly seed: string;
  readonly streams: ReadonlyMap<string, Readonly<RngStateWords>>;
}

const MAX_UINT32 = 0xffffffff;

const stateWordSchema = z
  .number({ error: 'must be a number' })
  .int({ error: 'must be a whole number' })
  .min(0, { error: 'must be an unsigned 32-bit word (0 or more)' })
  .max(MAX_UINT32, { error: `must be an unsigned 32-bit word (at most ${String(MAX_UINT32)})` });

/** Zod schema for {@link RngState}. Rejects unknown versions, bad stream names and non-uint32 words. */
export const rngStateSchema: z.ZodType<RngState> = z.strictObject({
  version: z.literal(1, { error: 'unsupported RNG state version (expected 1)' }),
  seed: z.string({ error: 'must be a string' }),
  streams: z.record(
    z.string().regex(STREAM_NAME_PATTERN),
    z.tuple([stateWordSchema, stateWordSchema, stateWordSchema, stateWordSchema], {
      error: 'must be an array of 4 unsigned 32-bit words',
    }),
    {
      // The record reports a bad key as its own issue, so the key message is set here too.
      error: (issue) => {
        if (issue.code === 'invalid_type') {
          return 'must be an object of stream states';
        }
        // The only other issue a record raises on its own is a bad key.
        return 'is not a valid stream name';
      },
    },
  ),
});

/**
 * Validates an unknown value as an {@link RngState}. Throws an error whose message names every
 * bad field (for example `streams["test.alpha"][2]`).
 */
export function parseRngState(input: unknown): RngState {
  const result = rngStateSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map(
    (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
  );
  throw new Error(`Invalid RNG state: ${problems.join('; ')}`);
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${String(segment)}]`;
      }
      const key = String(segment);
      if (/^[A-Za-z_$][\w$]*$/.test(key)) {
        return index === 0 ? key : `.${key}`;
      }
      return `[${JSON.stringify(key)}]`;
    })
    .join('');
}

/** The registry's private stream implementation. Exposed to callers only as {@link RngStream}. */
class SeededStream implements RngStream {
  readonly name: StreamName;
  readonly #generator: Sfc32;

  constructor(name: StreamName, stateWords: Readonly<RngStateWords>) {
    this.name = name;
    this.#generator = new Sfc32(stateWords);
  }

  nextUint32(): number {
    return this.#generator.nextUint32();
  }

  nextFloat(): number {
    return this.#generator.nextFloat();
  }

  readState(): RngStateWords {
    return this.#generator.getState();
  }

  writeState(stateWords: Readonly<RngStateWords>): void {
    this.#generator.setState(stateWords);
  }
}

/** Seeded, serialisable source of every random number in the engine. */
export class RngRegistry {
  /** The game seed every stream is derived from. */
  readonly seed: string;

  /** Every stream object handed out, kept so callers holding one stay in step after a restore. */
  readonly #streamsByName = new Map<string, SeededStream>();

  /** Names of the streams that count as touched: saved by `toState` and copied by `snapshot`. */
  readonly #touchedNames = new Set<string>();

  /**
   * Creates a registry for a seed. With `state`, the touched streams continue from that saved
   * state; its seed must match `seed`.
   */
  constructor(seed: string, state?: RngState) {
    this.seed = seed;
    if (state === undefined) {
      return;
    }
    const validState = parseRngState(state);
    if (validState.seed !== seed) {
      throw new Error(
        `RNG state seed ${JSON.stringify(validState.seed)} does not match registry seed ` +
          `${JSON.stringify(seed)}.`,
      );
    }
    for (const [name, stateWords] of Object.entries(validState.streams)) {
      this.#loadStream(name, stateWords);
    }
  }

  /** Rebuilds a registry from a serialised state (for example straight from `JSON.parse`). */
  static fromState(state: unknown): RngRegistry {
    const validState = parseRngState(state);
    return new RngRegistry(validState.seed, validState);
  }

  /**
   * Returns the named stream, creating it from the seed on first use. Repeat calls return the
   * same object, so a system can hold on to its stream.
   */
  stream(name: StreamName): RngStream {
    const existing = this.#streamsByName.get(name);
    if (existing !== undefined) {
      this.#touchedNames.add(name);
      return existing;
    }
    assertStreamName(name);
    const created = new SeededStream(name, seedState(this.seed, name));
    this.#streamsByName.set(name, created);
    this.#touchedNames.add(name);
    return created;
  }

  /** Copies the state of every stream touched so far. */
  snapshot(): RngSnapshot {
    const streams = new Map<string, Readonly<RngStateWords>>();
    for (const name of this.#touchedNames) {
      const touchedStream = this.#streamsByName.get(name);
      if (touchedStream !== undefined) {
        streams.set(name, Object.freeze(touchedStream.readState()));
      }
    }
    return { seed: this.seed, streams };
  }

  /**
   * Puts every stream back where it was when the snapshot was taken. Streams first touched after
   * the snapshot return to their seed-derived start and stop counting as touched. Stream objects
   * already handed out keep working and follow the restored state.
   */
  restore(snapshot: RngSnapshot): void {
    if (snapshot.seed !== this.seed) {
      throw new Error(
        `Cannot restore an RNG snapshot for seed ${JSON.stringify(snapshot.seed)} into a ` +
          `registry with seed ${JSON.stringify(this.seed)}.`,
      );
    }
    for (const name of [...this.#touchedNames]) {
      if (!snapshot.streams.has(name)) {
        this.#touchedNames.delete(name);
        this.#streamsByName.get(name)?.writeState(seedState(this.seed, name));
      }
    }
    for (const [name, stateWords] of snapshot.streams) {
      this.#loadStream(name, stateWords);
    }
  }

  /** Serialises the seed and every touched stream, with stream names in sorted order. */
  toState(): RngState {
    const streams: Record<string, RngStateWords> = {};
    for (const name of [...this.#touchedNames].sort()) {
      const touchedStream = this.#streamsByName.get(name);
      if (touchedStream !== undefined) {
        streams[name] = touchedStream.readState();
      }
    }
    return { version: 1, seed: this.seed, streams };
  }

  #loadStream(name: string, stateWords: Readonly<RngStateWords>): void {
    assertStreamName(name);
    this.#touchedNames.add(name);
    const existing = this.#streamsByName.get(name);
    if (existing === undefined) {
      this.#streamsByName.set(name, new SeededStream(name, stateWords));
    } else {
      existing.writeState(stateWords);
    }
  }
}
