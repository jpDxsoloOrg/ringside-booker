import { describe, expect, it } from 'vitest';
import {
  add,
  basisPoints,
  cents,
  compare,
  fromWhole,
  isCents,
  isNegative,
  mulRatio,
  negate,
  sub,
  sum,
  ZERO_CENTS,
} from '../../src/core/money';
import { InvalidArgumentError, MoneyOverflowError } from '../../src/core/errors';

const maxSafe = Number.MAX_SAFE_INTEGER;

describe('cents', () => {
  it('accepts whole numbers, including negatives', () => {
    expect(cents(0)).toBe(0);
    expect(cents(-250)).toBe(-250);
    expect(cents(maxSafe)).toBe(maxSafe);
    expect(isCents(12)).toBe(true);
  });

  it('rejects fractions and non-finite numbers', () => {
    expect(() => cents(1.5)).toThrow(InvalidArgumentError);
    expect(() => cents(Number.NaN)).toThrow(InvalidArgumentError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(InvalidArgumentError);
    expect(isCents(1.5)).toBe(false);
    expect(isCents('12')).toBe(false);
  });

  it('rejects whole numbers beyond the safe range', () => {
    expect(() => cents(maxSafe + 1)).toThrow(MoneyOverflowError);
  });

  it('converts whole units', () => {
    expect(fromWhole(12)).toBe(1200);
    expect(fromWhole(-3)).toBe(-300);
    expect(() => fromWhole(1.25)).toThrow(InvalidArgumentError);
    expect(() => fromWhole(maxSafe)).toThrow(MoneyOverflowError);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and negates', () => {
    expect(add(cents(150), cents(-50))).toBe(100);
    expect(sub(cents(150), cents(200))).toBe(-50);
    expect(negate(cents(75))).toBe(-75);
    expect(Object.is(negate(ZERO_CENTS), 0)).toBe(true);
  });

  it('sums a list, with an empty list giving 0', () => {
    expect(sum([])).toBe(0);
    expect(sum([cents(1), cents(2), cents(-4)])).toBe(-1);
  });

  it('throws instead of overflowing', () => {
    expect(() => add(cents(maxSafe), cents(1))).toThrow(MoneyOverflowError);
    expect(() => sub(cents(-maxSafe), cents(1))).toThrow(MoneyOverflowError);
    expect(() => sum([cents(maxSafe), cents(maxSafe)])).toThrow(MoneyOverflowError);
    expect(add(cents(maxSafe), cents(0))).toBe(maxSafe);
  });

  it('compares amounts', () => {
    expect(compare(cents(1), cents(2))).toBe(-1);
    expect(compare(cents(2), cents(1))).toBe(1);
    expect(compare(cents(2), cents(2))).toBe(0);
    expect(isNegative(cents(-1))).toBe(true);
    expect(isNegative(cents(0))).toBe(false);
  });
});

describe('mulRatio', () => {
  it('rounds halves away from zero, symmetrically', () => {
    expect(mulRatio(cents(5), 0.5)).toBe(3);
    expect(mulRatio(cents(-5), 0.5)).toBe(-3);
    expect(mulRatio(cents(4), 0.5)).toBe(2);
    expect(mulRatio(cents(-4), 0.5)).toBe(-2);
    expect(mulRatio(cents(7), 0.1)).toBe(1);
    expect(mulRatio(cents(1000), 1.075)).toBe(1075);
  });

  it('never returns negative zero', () => {
    expect(Object.is(mulRatio(cents(-1), 0.4), 0)).toBe(true);
  });

  it('rejects non-finite ratios and overflowing results', () => {
    expect(() => mulRatio(cents(5), Number.NaN)).toThrow(InvalidArgumentError);
    expect(() => mulRatio(cents(5), Number.POSITIVE_INFINITY)).toThrow(InvalidArgumentError);
    expect(() => mulRatio(cents(maxSafe), 2)).toThrow(MoneyOverflowError);
  });
});

describe('basisPoints', () => {
  it('takes a share of an amount', () => {
    expect(basisPoints(cents(10_000), 250)).toBe(250);
    expect(basisPoints(cents(10_000), 0)).toBe(0);
    expect(basisPoints(cents(10_000), 10_000)).toBe(10_000);
  });

  it('rounds halves away from zero', () => {
    expect(basisPoints(cents(1), 5000)).toBe(1);
    expect(basisPoints(cents(-1), 5000)).toBe(-1);
    expect(basisPoints(cents(1), 4999)).toBe(0);
    expect(basisPoints(cents(3), 5000)).toBe(2);
  });

  it('is exact for very large amounts', () => {
    expect(basisPoints(cents(maxSafe), 10_000)).toBe(maxSafe);
    expect(basisPoints(cents(maxSafe), 5000)).toBe(4_503_599_627_370_496);
  });

  it('rejects basis points outside 0..10000', () => {
    expect(() => basisPoints(cents(100), -1)).toThrow(InvalidArgumentError);
    expect(() => basisPoints(cents(100), 10_001)).toThrow(InvalidArgumentError);
    expect(() => basisPoints(cents(100), 2.5)).toThrow(InvalidArgumentError);
  });
});
