import {
  createIdFactory,
  type EntityKind,
  type IdEntropy,
  type IdFactory,
  type IdOf,
} from '../../src/core/ids';

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

/**
 * The ID with body `serial` that `sequentialIdEntropy` mints, such as `testId('person', 3)` =
 * `per_0000000003`. Builders use serial 1 as the default target of a reference, so a row built on
 * its own points at the first row of each kind.
 */
export function testId<K extends EntityKind>(kind: K, serial = 1): IdOf<K> {
  return createIdFactory(sequentialIdEntropy(serial)).next(kind, () => false);
}

/**
 * Deterministic counters for test data: one `sequentialIdEntropy` per entity kind, so IDs read
 * `per_0000000001`, `per_0000000002`, ... for people and `pro_0000000001`, ... for promotions;
 * placeholder-name numbers per category; and the card slots taken in each event instance.
 *
 * It is also an `IdFactory`, so a world built by `WorldBuilder` mints its rows and any later
 * `tx.create` from the same counters.
 */
export class TestIdSequence implements IdFactory {
  private readonly entropyByKind = new Map<EntityKind, IdEntropy>();
  private readonly numberByCategory = new Map<string, number>();
  private readonly slotsBySection = new Map<string, Set<number>>();

  next<K extends EntityKind>(kind: K, exists: (id: IdOf<K>) => boolean): IdOf<K> {
    let entropy = this.entropyByKind.get(kind);
    if (entropy === undefined) {
      entropy = sequentialIdEntropy();
      this.entropyByKind.set(kind, entropy);
    }
    return createIdFactory(entropy).next(kind, exists);
  }

  /** The next ID of `kind`. */
  id<K extends EntityKind>(kind: K): IdOf<K> {
    return this.next(kind, () => false);
  }

  /** The next placeholder number of `category`, starting at 1. */
  nextNumber(category: string): number {
    const number = (this.numberByCategory.get(category) ?? 0) + 1;
    this.numberByCategory.set(category, number);
    return number;
  }

  /**
   * Claims a card slot in one section (main card or pre-show) of an event instance: `requested`
   * when given, otherwise the lowest slot not claimed yet.
   */
  slot(eventInstanceId: string, preShow: boolean, requested?: number): number {
    const sectionKey = `${eventInstanceId}|${preShow ? 'pre' : 'main'}`;
    let taken = this.slotsBySection.get(sectionKey);
    if (taken === undefined) {
      taken = new Set();
      this.slotsBySection.set(sectionKey, taken);
    }
    let slot = requested ?? 0;
    if (requested === undefined) {
      while (taken.has(slot)) {
        slot += 1;
      }
    }
    taken.add(slot);
    return slot;
  }

  /** Forgets every counter, so the next IDs, numbers and slots start again from the beginning. */
  reset(): void {
    this.entropyByKind.clear();
    this.numberByCategory.clear();
    this.slotsBySection.clear();
  }
}

/**
 * The module-level sequence builders draw from when they are called on their own. Vitest gives
 * every test file its own module instance, and `test/support/setup.ts` calls `resetTestIds()`
 * before each test, so every test starts from `..._0000000001`.
 */
export const TestIds = new TestIdSequence();

/** Restarts the module-level `TestIds` counters. */
export function resetTestIds(): void {
  TestIds.reset();
}
