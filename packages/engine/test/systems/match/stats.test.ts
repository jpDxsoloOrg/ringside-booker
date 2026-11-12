// The batch preview's statistics (MTCH1-06): numeric sort, population sd, interpolated
// percentiles, 0.1 rounding, the 20-bin score histogram and the quarter-star counts.
// Design: docs/design/match-rating.md#previews
import { describe, expect, it } from 'vitest';
import {
  quantileOfSorted,
  quarterCounts,
  roundTenth,
  scoreHistogram,
  sortedNumbers,
  statsOf,
} from '../../../src/systems/match/stats';

describe('statsOf', () => {
  it('sorts numerically, not as text', () => {
    expect(sortedNumbers([10, 9, 100, 1])).toEqual([1, 9, 10, 100]);
    const stats = statsOf([10, 9, 100, 1]);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
  });

  it('uses the population standard deviation and rounds every field to 0.1', () => {
    // Mean 5, squared deviations 9 + 1 + 1 + 9 = 20, / 4 = 5, sd √5 = 2.236.
    expect(statsOf([2, 4, 6, 8])).toEqual({
      mean: 5,
      sd: 2.2,
      min: 2,
      p10: 2.6,
      p50: 5,
      p90: 7.4,
      max: 8,
    });
  });

  it('gives a single value as every statistic, with no spread', () => {
    expect(statsOf([42.25])).toEqual({
      mean: 42.3,
      sd: 0,
      min: 42.3,
      p10: 42.3,
      p50: 42.3,
      p90: 42.3,
      max: 42.3,
    });
  });

  it('refuses an empty list and non-finite values', () => {
    expect(() => statsOf([])).toThrow(RangeError);
    expect(() => statsOf([1, Number.NaN])).toThrow(RangeError);
    expect(() => quantileOfSorted([], 0.5)).toThrow(RangeError);
  });
});

describe('quantileOfSorted', () => {
  it('interpolates between the nearest ranks', () => {
    expect(quantileOfSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileOfSorted([0, 10], 0.1)).toBe(1);
    expect(quantileOfSorted([3, 7], 0)).toBe(3);
    expect(quantileOfSorted([3, 7], 1)).toBe(7);
  });
});

describe('roundTenth', () => {
  it('rounds to one decimal and never returns -0', () => {
    expect(roundTenth(1.25)).toBe(1.3);
    expect(roundTenth(-0.04)).toBe(0);
    expect(Object.is(roundTenth(-0.04), -0)).toBe(false);
  });
});

describe('scoreHistogram', () => {
  it('has 20 bins of 5 points, the last one closed', () => {
    const bins = scoreHistogram([0, 4, 5, 50, 99, 100]);
    expect(bins).toHaveLength(20);
    expect(bins[0]).toEqual({ from: 0, to: 5, count: 2 });
    expect(bins[1]).toEqual({ from: 5, to: 10, count: 1 });
    expect(bins[10]).toEqual({ from: 50, to: 55, count: 1 });
    expect(bins[19]).toEqual({ from: 95, to: 100, count: 2 });
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(6);
  });

  it('refuses an empty list', () => {
    expect(() => scoreHistogram([])).toThrow(RangeError);
  });
});

describe('quarterCounts', () => {
  it('counts every quarter from 0 to 5 stars', () => {
    const counts = quarterCounts([2.5, 2.5, 3.75, 0]);
    expect(counts).toHaveLength(21);
    expect(counts[0]).toEqual({ stars: 0, count: 1 });
    expect(counts.find((entry) => entry.stars === 2.5)?.count).toBe(2);
    expect(counts.find((entry) => entry.stars === 3.75)?.count).toBe(1);
    expect(counts[20]).toEqual({ stars: 5, count: 0 });
  });

  it('reaches past 5 when a raised cap lets a rating go there', () => {
    expect(quarterCounts([5.5]).at(-1)).toEqual({ stars: 5.5, count: 1 });
  });

  it('refuses an empty list', () => {
    expect(() => quarterCounts([])).toThrow(RangeError);
  });
});
