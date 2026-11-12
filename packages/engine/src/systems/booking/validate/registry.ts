/**
 * The booking-check registry: every rule a card is held to before it can be locked.
 *
 * EVT2's own checks register here with orders 100–190; other features (brand exclusivity, sent-down
 * workers, tour deals, finishes, beat limits) register theirs with orders 200 and up, without
 * editing booking's files. Checks run in `order`, then by id. A check that throws becomes one
 * `checkFailed` warning, so a bug in a later feature can never stop a card from being locked.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import { RegistryError } from '../../../core/errors';
import type { BookingCheck, BookingCheckInput, BookingIssue } from './types';

/** `system.camelName`: a lower-case system id, a dot, then a camelCase name. */
const CHECK_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/** The code of the warning a throwing check turns into. */
export const CHECK_FAILED_CODE = 'checkFailed';

const checks = new Map<string, BookingCheck>();

function compareChecks(left: BookingCheck, right: BookingCheck): number {
  return left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * Adds a booking check. Throws `RegistryError` for an id that is not `system.camelName`, an order
 * that is not a finite number, or an id already registered. Returns a function that removes it
 * again (for tests).
 */
export function registerBookingCheck(check: BookingCheck): () => void {
  if (!CHECK_ID_PATTERN.test(check.id)) {
    throw new RegistryError(
      `Booking check id ${JSON.stringify(check.id)} must look like "system.camelName"`,
      { check: check.id },
    );
  }
  if (!Number.isFinite(check.order)) {
    throw new RegistryError(`Booking check ${check.id} needs a finite order`, { check: check.id });
  }
  if (checks.has(check.id)) {
    throw new RegistryError(`Booking check ${check.id} is already registered`, {
      check: check.id,
    });
  }
  checks.set(check.id, check);
  return () => {
    if (checks.get(check.id) === check) {
      checks.delete(check.id);
    }
  };
}

/** Every registered check, in the order they run. */
export function registeredBookingChecks(): readonly BookingCheck[] {
  return [...checks.values()].sort(compareChecks);
}

/** The issues of one check run, with `checkId` filled in, or one `checkFailed` warning. */
export interface CheckRun {
  readonly check: BookingCheck;
  readonly issues: readonly BookingIssue[];
}

/** Runs every registered check against `input`, in order. */
export function runBookingChecks(input: BookingCheckInput): CheckRun[] {
  return registeredBookingChecks().map((check) => {
    try {
      const issues = check
        .run(input)
        .map((issue): BookingIssue => ({ ...issue, checkId: check.id }));
      return { check, issues };
    } catch {
      return {
        check,
        issues: [
          {
            checkId: check.id,
            code: CHECK_FAILED_CODE,
            severity: 'warning',
            message: `A booking check (${check.id}) failed; the card can still be locked`,
          },
        ],
      };
    }
  });
}
