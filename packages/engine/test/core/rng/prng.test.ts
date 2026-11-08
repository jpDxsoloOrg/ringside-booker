import './testStreams';
import { describe, expect, it } from 'vitest';
import { RngRegistry, WARM_UP_DRAWS, seedState } from '@ringside/engine';
import { Sfc32, guardZeroState } from '../../../src/core/rng/prng';
import { hashString128 } from '../../../src/core/hash';

// Regression lock: the first 10 outputs of seed "rb-test", stream "test.alpha". The same frozen
// array must come out of every JavaScript engine (Node, browsers, Web Workers). If this test
// fails, the generator, the seeding or the warm-up changed, and every existing save would play
// out a different future. Revert, or ship a save migration that re-seeds.
const GOLDEN_TEST_ALPHA_OUTPUTS: readonly number[] = [
  0x4863c144, 0xe7d19d08, 0xb04e4f7e, 0x36ed778c, 0x3439c2a1, 0x991a6446, 0x50257d78, 0xb3f6a3ee,
  0xcdfcecdf, 0x20148b85,
];

const GOLDEN_TEST_ALPHA_SEEDED_STATE: readonly number[] = [
  855986212, 98868705, 392293777, 259642175,
];

/** Chi-square critical value for 15 degrees of freedom at the 99.9% level. */
const CHI_SQUARE_CRITICAL_15_DF_999 = 37.697;

describe('sfc32 generator', () => {
  it('produces the frozen golden outputs for seed "rb-test", stream "test.alpha"', () => {
    const alpha = new RngRegistry('rb-test').stream('test.alpha');
    const outputs = Array.from({ length: GOLDEN_TEST_ALPHA_OUTPUTS.length }, () =>
      alpha.nextUint32(),
    );
    expect(outputs).toEqual(GOLDEN_TEST_ALPHA_OUTPUTS);
  });

  it('derives the frozen golden seeded state', () => {
    expect(seedState('rb-test', 'test.alpha')).toEqual(GOLDEN_TEST_ALPHA_SEEDED_STATE);
  });

  it('seeds from the hash of seed, NUL and stream name, then warms up', () => {
    const generator = new Sfc32(hashString128('rb-test\u0000test.alpha'));
    for (let draw = 0; draw < WARM_UP_DRAWS; draw++) {
      generator.nextUint32();
    }
    expect(WARM_UP_DRAWS).toBe(12);
    expect(generator.getState()).toEqual(seedState('rb-test', 'test.alpha'));
  });

  it('keeps 1,000,000 nextFloat draws in [0, 1) with a mean within 0.001 of 0.5', () => {
    const generator = new Sfc32(seedState('rb-test', 'test.alpha'));
    const drawCount = 1_000_000;
    let total = 0;
    let outOfRangeCount = 0;
    for (let draw = 0; draw < drawCount; draw++) {
      const value = generator.nextFloat();
      if (value < 0 || value >= 1) {
        outOfRangeCount++;
      }
      total += value;
    }
    expect(outOfRangeCount).toBe(0);
    expect(Math.abs(total / drawCount - 0.5)).toBeLessThan(0.001);
  });

  it('spreads 160,000 nextUint32 draws evenly over 16 buckets (chi-square, 99.9%)', () => {
    const generator = new Sfc32(seedState('rb-test', 'test.beta'));
    const bucketCount = 16;
    const drawCount = 160_000;
    const bucketCounts = new Array<number>(bucketCount).fill(0);
    for (let draw = 0; draw < drawCount; draw++) {
      const bucketIndex = generator.nextUint32() >>> 28;
      bucketCounts[bucketIndex] = (bucketCounts[bucketIndex] ?? 0) + 1;
    }
    const expectedPerBucket = drawCount / bucketCount;
    const chiSquare = bucketCounts.reduce(
      (sum, observed) => sum + (observed - expectedPerBucket) ** 2 / expectedPerBucket,
      0,
    );
    expect(chiSquare).toBeLessThan(CHI_SQUARE_CRITICAL_15_DF_999);
  });

  it('only ever returns unsigned 32-bit integers from nextUint32', () => {
    const generator = new Sfc32([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
    for (let draw = 0; draw < 1000; draw++) {
      const value = generator.nextUint32();
      expect(Number.isInteger(value) && value >= 0 && value <= 0xffffffff).toBe(true);
    }
  });

  it('round-trips its state through getState and setState', () => {
    const generator = new Sfc32(seedState('rb-test', 'test.alpha'));
    generator.nextUint32();
    const savedState = generator.getState();
    const expectedNext = [generator.nextUint32(), generator.nextUint32()];
    generator.setState(savedState);
    expect([generator.nextUint32(), generator.nextUint32()]).toEqual(expectedNext);
  });
});

describe('guardZeroState', () => {
  it('replaces the all-zero state with a fixed non-zero state', () => {
    const guarded = guardZeroState([0, 0, 0, 0]);
    expect(guarded.some((word) => word !== 0)).toBe(true);
    expect(guardZeroState([0, 0, 0, 0])).toEqual(guarded);
  });

  it('leaves any other state unchanged', () => {
    expect(guardZeroState([0, 0, 0, 1])).toEqual([0, 0, 0, 1]);
    expect(guardZeroState([5, 6, 7, 8])).toEqual([5, 6, 7, 8]);
  });
});
