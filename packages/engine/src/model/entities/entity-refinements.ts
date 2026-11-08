/**
 * Small helpers shared by the entity schemas and their invariants: uniqueness and ordering
 * predicates, the "non-null exactly when" rule used by status fields, and the display-name schema.
 */

import { z } from 'zod';
import { compareDates, type GameDate } from '../../core/date';

/** True when some value appears more than once. */
export function hasDuplicates(values: readonly (string | number)[]): boolean {
  return new Set(values).size !== values.length;
}

/** True when every value is strictly greater than the one before it (and so also unique). */
export function isStrictlyAscending(values: readonly string[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}

/** True when `value` is non-null exactly when `condition` holds. */
export function isPresentIff(value: unknown, condition: boolean): boolean {
  return (value !== null) === condition;
}

/** True when `later` is null (open-ended) or on or after `earlier`. */
export function isOpenOrOnOrAfter(later: GameDate | null, earlier: GameDate): boolean {
  return later === null || compareDates(later, earlier) >= 0;
}

/** A display name of 1 to `maxLength` characters that is not only whitespace. */
export function zName(maxLength: number): z.ZodString {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0, { message: 'Expected visible text' });
}
