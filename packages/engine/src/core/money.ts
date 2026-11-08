/**
 * Money as integer cents.
 *
 * Every amount of money in the engine is a `Cents`: a safe integer number of cents, negative for
 * costs and debts. Floats are never used for money, because decades of daily wage accruals would
 * drift and break the determinism promise. All rounding goes through `mulRatio` and `basisPoints`
 * so every formula rounds the same way: to the nearest cent, halves away from zero.
 *
 * Any result outside the safe integer range throws `MoneyOverflowError` instead of silently losing
 * precision.
 */

import type { Brand } from './brand';
import { InvalidArgumentError, MoneyOverflowError } from './errors';

export type Cents = Brand<number, 'Cents'>;

/** Cents per whole currency unit. */
export const CENTS_PER_UNIT = 100;
/** The basis points that make up 100%. */
export const BASIS_POINTS_PER_WHOLE = 10_000;

/** True when `value` is a valid amount of cents (a safe integer, may be negative). */
export function isCents(value: unknown): value is Cents {
  return Number.isSafeInteger(value);
}

/**
 * The single place a number becomes Cents. Throws `MoneyOverflowError` when it is not a safe
 * integer, and folds negative zero into zero so saves never hold `-0`.
 */
function checkedCents(operation: string, value: number): Cents {
  const normalized = value === 0 ? 0 : value;
  if (!isCents(normalized)) {
    throw new MoneyOverflowError(operation, value);
  }
  return normalized;
}

/**
 * Returns `amount` as Cents. Throws `InvalidArgumentError` for fractions, NaN and infinities, and
 * `MoneyOverflowError` for whole numbers beyond the safe integer range.
 */
export function cents(amount: number): Cents {
  if (!Number.isInteger(amount)) {
    throw new InvalidArgumentError('cents', 'amount', amount, 'a whole number of cents');
  }
  return checkedCents('cents', amount);
}

/** Zero cents. */
export const ZERO_CENTS: Cents = cents(0);

/** A whole number of currency units in cents: `fromWhole(12)` is 1200 cents. */
export function fromWhole(units: number): Cents {
  if (!Number.isInteger(units)) {
    throw new InvalidArgumentError('fromWhole', 'units', units, 'a whole number');
  }
  return checkedCents('fromWhole', units * CENTS_PER_UNIT);
}

export function add(left: Cents, right: Cents): Cents {
  return checkedCents('add', left + right);
}

export function sub(left: Cents, right: Cents): Cents {
  return checkedCents('sub', left - right);
}

/** The total of `amounts`; 0 for an empty list. */
export function sum(amounts: readonly Cents[]): Cents {
  let total = ZERO_CENTS;
  for (const amount of amounts) {
    total = add(total, amount);
  }
  return total;
}

export function negate(amount: Cents): Cents {
  return checkedCents('negate', 0 - amount);
}

/** Rounds to the nearest integer with halves going away from zero, so 2.5 → 3 and -2.5 → -3. */
function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.round(Math.abs(value));
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/**
 * `amount` multiplied by a finite `ratio`, rounded to the nearest cent with halves going away
 * from zero. Rounding is symmetric: `mulRatio(5, 0.5)` is 3 and `mulRatio(-5, 0.5)` is -3.
 */
export function mulRatio(amount: Cents, ratio: number): Cents {
  if (!Number.isFinite(ratio)) {
    throw new InvalidArgumentError('mulRatio', 'ratio', ratio, 'a finite number');
  }
  return checkedCents('mulRatio', roundHalfAwayFromZero(amount * ratio));
}

/**
 * `bp` basis points of `amount` (250 bp = 2.5%), rounded like `mulRatio`. Uses exact integer
 * arithmetic, so it is safe for any amount. `bp` must be a whole number in 0..10000.
 */
export function basisPoints(amount: Cents, bp: number): Cents {
  if (!Number.isInteger(bp) || bp < 0 || bp > BASIS_POINTS_PER_WHOLE) {
    throw new InvalidArgumentError('basisPoints', 'bp', bp, 'a whole number in 0..10000');
  }
  const whole = BigInt(BASIS_POINTS_PER_WHOLE);
  const product = BigInt(amount) * BigInt(bp);
  const quotient = product / whole;
  const remainder = product % whole;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const roundsAway = absoluteRemainder * 2n >= whole;
  const sign = product < 0n ? -1n : 1n;
  const rounded = roundsAway ? quotient + sign : quotient;
  return checkedCents('basisPoints', Number(rounded));
}

/** -1 when `left` is smaller, 1 when it is larger, 0 when equal. Usable as a sort comparator. */
export function compare(left: Cents, right: Cents): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** True when `amount` is below zero. */
export function isNegative(amount: Cents): boolean {
  return amount < 0;
}
