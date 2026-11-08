import './testStreams';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  InvalidOddsError,
  RngRegistry,
  chance,
  clampedNormal,
  floatBetween,
  intBetween,
  normal,
  oneIn,
  percent,
  pick,
  shuffle,
  weightedPick,
  type RngStream,
} from '@ringside/engine';

const SEED = 'rb-odds';

function freshStream(seed = SEED): RngStream {
  return new RngRegistry(seed).stream('test.alpha');
}

/** Two streams in the same state, for checking that two calls consumed the same draws. */
function twinStreams(): [RngStream, RngStream] {
  return [freshStream(), freshStream()];
}

function countTrue(draws: number, roll: () => boolean): number {
  let hits = 0;
  for (let draw = 0; draw < draws; draw++) {
    if (roll()) {
      hits++;
    }
  }
  return hits;
}

describe('intBetween', () => {
  it('hits every face of 1..6 within 1% of 100,000 over 600,000 draws and never 0 or 7', () => {
    const stream = freshStream();
    const faceCounts = new Map<number, number>();
    for (let draw = 0; draw < 600_000; draw++) {
      const face = intBetween(stream, 1, 6);
      faceCounts.set(face, (faceCounts.get(face) ?? 0) + 1);
    }
    expect([...faceCounts.keys()].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of faceCounts.values()) {
      expect(count).toBeGreaterThanOrEqual(99_000);
      expect(count).toBeLessThanOrEqual(101_000);
    }
  });

  it('returns min when min equals max', () => {
    const stream = freshStream();
    for (let draw = 0; draw < 100; draw++) {
      expect(intBetween(stream, 5, 5)).toBe(5);
    }
  });

  it('reaches both ends of a negative range', () => {
    const stream = freshStream();
    const seen = new Set<number>();
    for (let draw = 0; draw < 1_000; draw++) {
      seen.add(intBetween(stream, -3, -1));
    }
    expect([...seen].sort((left, right) => left - right)).toEqual([-3, -2, -1]);
  });

  it('handles the full 2^32 range without rejecting', () => {
    const [plain, raw] = twinStreams();
    expect(intBetween(plain, 0, 0xffff_ffff)).toBe(raw.nextUint32());
  });

  it('throws an InvalidOddsError naming both values when the bounds are reversed', () => {
    const stream = freshStream();
    expect(() => intBetween(stream, 6, 1)).toThrow(InvalidOddsError);
    expect(() => intBetween(stream, 6, 1)).toThrow(/min \(6\).*max \(1\)/);
  });

  it('throws on non-integer and non-finite bounds', () => {
    const stream = freshStream();
    expect(() => intBetween(stream, 1.5, 3)).toThrow(InvalidOddsError);
    expect(() => intBetween(stream, 1.5, 3)).toThrow(/1\.5/);
    expect(() => intBetween(stream, 1, 3.25)).toThrow(/3\.25/);
    expect(() => intBetween(stream, Number.NaN, 3)).toThrow(/NaN/);
    expect(() => intBetween(stream, 0, Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
  });

  it('throws when the range holds more than 2^32 values', () => {
    expect(() => intBetween(freshStream(), 0, 0x1_0000_0000)).toThrow(InvalidOddsError);
  });
});

describe('chance and percent', () => {
  it('chance(0) is never true and chance(1) is always true over 100,000 draws', () => {
    const stream = freshStream();
    expect(countTrue(100_000, () => chance(stream, 0))).toBe(0);
    expect(countTrue(100_000, () => chance(stream, 1))).toBe(100_000);
  });

  it('chance(0.15) comes up between 14.9% and 15.1% over 1,000,000 draws', () => {
    const stream = freshStream();
    const rate = countTrue(1_000_000, () => chance(stream, 0.15)) / 1_000_000;
    expect(rate).toBeGreaterThanOrEqual(0.149);
    expect(rate).toBeLessThanOrEqual(0.151);
  });

  it('percent(15) equals chance(0.15) draw for draw', () => {
    const [percentStream, chanceStream] = twinStreams();
    for (let draw = 0; draw < 10_000; draw++) {
      expect(percent(percentStream, 15)).toBe(chance(chanceStream, 0.15));
    }
  });

  it('rejects probabilities outside [0, 1] and non-finite values, naming the value', () => {
    const stream = freshStream();
    expect(() => chance(stream, -0.1)).toThrow(/-0\.1/);
    expect(() => chance(stream, 1.5)).toThrow(/1\.5/);
    expect(() => chance(stream, Number.NaN)).toThrow(/NaN/);
    expect(() => percent(stream, 101)).toThrow(/101/);
    expect(() => percent(stream, -1)).toThrow(InvalidOddsError);
  });

  it('does not draw when the argument is rejected', () => {
    const [checked, raw] = twinStreams();
    expect(() => chance(checked, 2)).toThrow(InvalidOddsError);
    expect(checked.nextUint32()).toBe(raw.nextUint32());
  });
});

describe('oneIn', () => {
  it('oneIn(1) is always true', () => {
    const stream = freshStream();
    expect(countTrue(10_000, () => oneIn(stream, 1))).toBe(10_000);
  });

  it('oneIn(4) comes up between 24.7% and 25.3% over 400,000 draws', () => {
    const stream = freshStream();
    const rate = countTrue(400_000, () => oneIn(stream, 4)) / 400_000;
    expect(rate).toBeGreaterThanOrEqual(0.247);
    expect(rate).toBeLessThanOrEqual(0.253);
  });

  it('rejects counts below 1 and non-integers', () => {
    const stream = freshStream();
    expect(() => oneIn(stream, 0)).toThrow(/count must be at least 1, got 0/);
    expect(() => oneIn(stream, 2.5)).toThrow(/2\.5/);
  });
});

describe('floatBetween', () => {
  it('stays inside [min, max)', () => {
    const stream = freshStream();
    for (let draw = 0; draw < 10_000; draw++) {
      const value = floatBetween(stream, -2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(3);
    }
  });

  it('returns min when min equals max', () => {
    expect(floatBetween(freshStream(), 4.5, 4.5)).toBe(4.5);
  });

  it('keeps max excluded when rounding would land on it', () => {
    // At 1e16 doubles are 2 apart, so min + 0.99... * 2 rounds up to max without the guard.
    const stream: RngStream = {
      name: 'test.alpha',
      nextUint32: () => 0xffff_ffff,
      nextFloat: () => 0xffff_ffff / 0x1_0000_0000,
    };
    expect(floatBetween(stream, 1e16, 1e16 + 2)).toBeLessThan(1e16 + 2);
    expect(floatBetween(stream, -4, 0)).toBeLessThan(0);
  });

  it('throws when min > max or a bound is not finite', () => {
    const stream = freshStream();
    expect(() => floatBetween(stream, 2, 1)).toThrow(/min \(2\).*max \(1\)/);
    expect(() => floatBetween(stream, 0, Number.POSITIVE_INFINITY)).toThrow(InvalidOddsError);
  });
});

describe('pick', () => {
  it('reaches every item, first and last included', () => {
    const stream = freshStream();
    const items = ['a', 'b', 'c', 'd'];
    const seen = new Set<string>();
    for (let draw = 0; draw < 1_000; draw++) {
      seen.add(pick(stream, items));
    }
    expect([...seen].sort()).toEqual(items);
  });

  it('can pick an item that is itself undefined', () => {
    const items: (string | undefined)[] = [undefined];
    expect(pick(freshStream(), items)).toBeUndefined();
  });

  it('throws on an empty list', () => {
    expect(() => pick(freshStream(), [])).toThrow(/empty/);
  });
});

describe('weightedPick', () => {
  it('gives the second item 75% (±0.5%) for weights [1, 3] over 400,000 draws', () => {
    const stream = freshStream();
    const entries = [
      { item: 'light', weight: 1 },
      { item: 'heavy', weight: 3 },
    ];
    const rate = countTrue(400_000, () => weightedPick(stream, entries) === 'heavy') / 400_000;
    expect(rate).toBeGreaterThanOrEqual(0.745);
    expect(rate).toBeLessThanOrEqual(0.755);
  });

  it('never picks a zero-weight item, wherever it sits', () => {
    const stream = freshStream();
    const entries = [
      { item: 'zero-first', weight: 0 },
      { item: 'one', weight: 1 },
      { item: 'zero-middle', weight: 0 },
      { item: 'two', weight: 2 },
      { item: 'zero-last', weight: 0 },
    ];
    const seen = new Set<string>();
    for (let draw = 0; draw < 50_000; draw++) {
      seen.add(weightedPick(stream, entries));
    }
    expect([...seen].sort()).toEqual(['one', 'two']);
  });

  it('gives the top of the range to the last positive weight, not a trailing zero weight', () => {
    const stream: RngStream = {
      name: 'test.alpha',
      nextUint32: () => 0xffff_ffff,
      nextFloat: () => 0xffff_ffff / 0x1_0000_0000,
    };
    const entries = [
      { item: 'one', weight: 1 },
      { item: 'zero', weight: 0 },
    ];
    expect(weightedPick(stream, entries)).toBe('one');
  });

  it('throws when every weight is 0', () => {
    const entries = [
      { item: 'a', weight: 0 },
      { item: 'b', weight: 0 },
    ];
    expect(() => weightedPick(freshStream(), entries)).toThrow(/must not all be 0/);
  });

  it('throws on a negative or non-finite weight, naming the entry and the value', () => {
    const stream = freshStream();
    expect(() =>
      weightedPick(stream, [
        { item: 'a', weight: 1 },
        { item: 'b', weight: -2 },
      ]),
    ).toThrow(/entries\[1\]\.weight .* got -2/);
    expect(() => weightedPick(stream, [{ item: 'a', weight: Number.NaN }])).toThrow(/NaN/);
    expect(() => weightedPick(stream, [{ item: 'a', weight: Number.POSITIVE_INFINITY }])).toThrow(
      /Infinity/,
    );
  });

  it('throws on an empty list', () => {
    expect(() => weightedPick(freshStream(), [])).toThrow(/empty/);
  });
});

describe('shuffle', () => {
  it('keeps the multiset and leaves the input untouched', () => {
    const stream = freshStream();
    const input = Object.freeze([1, 1, 2, 3, 5, 8, 13, 21]);
    const shuffled = shuffle(stream, input);
    expect(shuffled).not.toBe(input);
    expect([...shuffled].sort((left, right) => left - right)).toEqual([...input]);
    expect(input).toEqual([1, 1, 2, 3, 5, 8, 13, 21]);
  });

  it('produces every order of three items', () => {
    const stream = freshStream();
    const orders = new Set<string>();
    for (let draw = 0; draw < 600; draw++) {
      orders.add(shuffle(stream, ['a', 'b', 'c']).join(''));
    }
    expect(orders.size).toBe(6);
  });

  it('returns a new empty array for an empty input without drawing', () => {
    const [shuffled, raw] = twinStreams();
    expect(shuffle(shuffled, [])).toEqual([]);
    expect(shuffled.nextUint32()).toBe(raw.nextUint32());
  });
});

describe('normal and clampedNormal', () => {
  it('normal(0, 1) over 200,000 draws has mean and sd within 0.01', () => {
    const stream = freshStream();
    const sampleCount = 200_000;
    const samples = Array.from({ length: sampleCount }, () => normal(stream, 0, 1));
    const mean = samples.reduce((total, value) => total + value, 0) / sampleCount;
    const variance =
      samples.reduce((total, value) => total + (value - mean) ** 2, 0) / (sampleCount - 1);
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(Math.sqrt(variance) - 1)).toBeLessThanOrEqual(0.01);
  });

  it('normal with sd 0 returns the mean', () => {
    expect(normal(freshStream(), 7, 0)).toBe(7);
  });

  it('redraws the first draw when it is exactly 0', () => {
    const floats = [0, 0, 0.5, 0.25];
    const stream: RngStream = {
      name: 'test.alpha',
      nextUint32: () => 0,
      nextFloat: () => floats.shift() ?? 0.5,
    };
    const value = normal(stream, 0, 1);
    expect(Number.isFinite(value)).toBe(true);
    expect(floats).toEqual([]);
  });

  it('clampedNormal stays within [min, max] with both ends reachable', () => {
    const stream = freshStream();
    const values = Array.from({ length: 10_000 }, () => clampedNormal(stream, 50, 30, 40, 60));
    expect(Math.min(...values)).toBe(40);
    expect(Math.max(...values)).toBe(60);
  });

  it('rejects a negative sd and bad clamp bounds', () => {
    const stream = freshStream();
    expect(() => normal(stream, 0, -1)).toThrow(/sd must be 0 or more, got -1/);
    expect(() => normal(stream, Number.NaN, 1)).toThrow(/mean/);
    expect(() => clampedNormal(stream, 0, 1, 5, 4)).toThrow(/min \(5\).*max \(4\)/);
  });
});

describe('draw-count invariants', () => {
  /**
   * Runs `first` on one stream and `second` on its twin, then checks both streams give the same
   * next raw draw: the two calls consumed the same number of draws.
   */
  function expectSameDraws(first: (stream: RngStream) => unknown, second: typeof first): void {
    const [firstStream, secondStream] = twinStreams();
    first(firstStream);
    second(secondStream);
    expect(firstStream.nextUint32()).toBe(secondStream.nextUint32());
  }

  /** The same, against a stream that made a fixed number of raw draws. */
  function expectDrawCount(call: (stream: RngStream) => unknown, expectedDraws: number): void {
    const [called, raw] = twinStreams();
    call(called);
    for (let draw = 0; draw < expectedDraws; draw++) {
      raw.nextUint32();
    }
    expect(called.nextUint32()).toBe(raw.nextUint32());
  }

  it('chance always consumes one draw, for 0, 1 and anything between', () => {
    for (const probability of [0, 0.15, 0.5, 1]) {
      expectDrawCount((stream) => chance(stream, probability), 1);
    }
  });

  it('percent always consumes one draw', () => {
    for (const k of [0, 15, 100]) {
      expectDrawCount((stream) => percent(stream, k), 1);
    }
  });

  it('intBetween consumes one draw for ranges that never reject', () => {
    // Power-of-two spans divide 2^32, so no value is ever rejected.
    expectDrawCount((stream) => intBetween(stream, 5, 5), 1);
    expectDrawCount((stream) => intBetween(stream, 0, 1), 1);
    expectDrawCount((stream) => intBetween(stream, 1, 256), 1);
    expectDrawCount((stream) => intBetween(stream, -(2 ** 31), 2 ** 31 - 1), 1);
    expectSameDraws(
      (stream) => intBetween(stream, 1, 6),
      (stream) => intBetween(stream, 100, 1_000),
    );
  });

  it('oneIn consumes one draw whatever n is', () => {
    expectDrawCount((stream) => oneIn(stream, 1), 1);
    expectDrawCount((stream) => oneIn(stream, 4), 1);
    expectSameDraws(
      (stream) => oneIn(stream, 2),
      (stream) => oneIn(stream, 1_000),
    );
  });

  it('floatBetween consumes one draw', () => {
    expectDrawCount((stream) => floatBetween(stream, 0, 1), 1);
    expectDrawCount((stream) => floatBetween(stream, 3, 3), 1);
  });

  it('pick consumes one draw whatever the list', () => {
    expectDrawCount((stream) => pick(stream, ['only']), 1);
    expectDrawCount((stream) => pick(stream, ['a', 'b', 'c', 'd']), 1);
  });

  it('weightedPick consumes one draw whatever the weights', () => {
    expectDrawCount((stream) => weightedPick(stream, [{ item: 'only', weight: 1 }]), 1);
    expectSameDraws(
      (stream) =>
        weightedPick(stream, [
          { item: 'a', weight: 1 },
          { item: 'b', weight: 3 },
        ]),
      (stream) =>
        weightedPick(stream, [
          { item: 'a', weight: 0 },
          { item: 'b', weight: 0.001 },
          { item: 'c', weight: 900 },
        ]),
    );
  });

  it('shuffle consumes length - 1 draws whatever the contents', () => {
    expectDrawCount((stream) => shuffle(stream, [1, 2, 3, 4]), 3);
    expectSameDraws(
      (stream) => shuffle(stream, ['a', 'b', 'c']),
      (stream) => shuffle(stream, [9, 8, 7]),
    );
  });

  it('normal and clampedNormal consume two draws whatever the arguments', () => {
    expectDrawCount((stream) => normal(stream, 0, 1), 2);
    expectDrawCount((stream) => normal(stream, 100, 0), 2);
    expectDrawCount((stream) => clampedNormal(stream, 50, 10, 0, 100), 2);
    expectDrawCount((stream) => clampedNormal(stream, 50, 10, 50, 50), 2);
  });
});

/** Runs a call that must fail and returns what it threw, narrowed to an InvalidOddsError. */
function catchOddsError(badCall: () => unknown): InvalidOddsError {
  try {
    badCall();
  } catch (error) {
    if (error instanceof InvalidOddsError) {
      return error;
    }
    throw new Error(`Expected an InvalidOddsError, got ${String(error)}`);
  }
  throw new Error('Expected an InvalidOddsError, but nothing was thrown');
}

describe('odds helper errors', () => {
  const badCalls: readonly [string, (stream: RngStream) => unknown][] = [
    ['chance', (stream) => chance(stream, 1.5)],
    ['percent', (stream) => percent(stream, 101)],
    ['intBetween', (stream) => intBetween(stream, 6, 1)],
    ['oneIn', (stream) => oneIn(stream, 0)],
    ['floatBetween', (stream) => floatBetween(stream, 2, 1)],
    ['pick', (stream) => pick(stream, [])],
    ['weightedPick', (stream) => weightedPick(stream, [{ item: 'a', weight: -1 }])],
    ['normal', (stream) => normal(stream, 0, -1)],
    ['clampedNormal', (stream) => clampedNormal(stream, 0, 1, 5, 4)],
  ];

  it.each(badCalls)(
    '%s throws an InvalidOddsError that is an EngineError, not a bare RangeError',
    (functionName, badCall) => {
      const oddsError = catchOddsError(() => badCall(freshStream()));
      expect(oddsError).toBeInstanceOf(EngineError);
      expect(oddsError).not.toBeInstanceOf(RangeError);
      expect(oddsError.code).toBe('INVALID_ODDS');
      expect(oddsError.name).toBe('InvalidOddsError');
      expect(oddsError.message.startsWith(`${functionName}: `)).toBe(true);
      expect(oddsError.details?.['functionName']).toBe(functionName);
    },
  );

  it('carries the bad argument and value in its details', () => {
    const oddsError = catchOddsError(() => chance(freshStream(), Number.NaN));
    expect(oddsError.details).toEqual({
      functionName: 'chance',
      argumentName: 'probability',
      value: 'NaN',
    });
  });

  it('is thrown before anything is drawn, so a rejected call leaves the stream alone', () => {
    const [rejected, untouched] = twinStreams();
    catchOddsError(() => intBetween(rejected, 6, 1));
    expect(rejected.nextUint32()).toBe(untouched.nextUint32());
  });
});
