/**
 * `employment-dates`: every contract in a pack is running when the world starts, so:
 *
 * - it starts on or before the start date (error);
 * - it ends after it starts, or is open-ended (error);
 * - it has not already ended by the start date (error);
 * - nobody holds two exclusive contracts at once on the start date (error);
 * - expiries are spread out: more than a quarter of all contracts ending inside one 30-day window
 *   would make a wave of free agents in one month (warning).
 */

import { compareDates, diffDays, type GameDate } from '@ringside/engine';
import type { ValidationIssue } from '../issues';
import {
  isEmploymentActiveOn,
  recordIssue,
  refKey,
  sortedRecords,
  worldStartDate,
  type ContentRule,
  type MergedRecordOf,
} from './helpers';

/** Length of the expiry window, in days. */
export const EXPIRY_WINDOW_DAYS = 30;

/** Largest share of all contracts that may expire inside one window before the rule warns. */
export const MAX_EXPIRY_SHARE = 0.25;

type EmploymentEntry = [string, MergedRecordOf<'employment'>];

interface Expiry {
  readonly key: string;
  readonly merged: MergedRecordOf<'employment'>;
  readonly endsOn: GameDate;
}

function expiryCluster(entries: readonly EmploymentEntry[]): ValidationIssue[] {
  const expiries: Expiry[] = [];
  for (const [key, merged] of entries) {
    if (merged.record.endsOn !== null) {
      expiries.push({ key, merged, endsOn: merged.record.endsOn });
    }
  }
  expiries.sort(
    (left, right) =>
      compareDates(left.endsOn, right.endsOn) ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
  // Slide a window over the sorted expiries and keep the busiest one (the earliest on a tie).
  let best = { from: 0, count: 0 };
  let windowStart = 0;
  expiries.forEach((expiry, index) => {
    while (
      diffDays(expiries[windowStart]?.endsOn ?? expiry.endsOn, expiry.endsOn) >= EXPIRY_WINDOW_DAYS
    ) {
      windowStart += 1;
    }
    const count = index - windowStart + 1;
    if (count > best.count) {
      best = { from: windowStart, count };
    }
  });
  const first = expiries[best.from];
  const last = expiries[best.from + best.count - 1];
  if (
    first === undefined ||
    last === undefined ||
    best.count / entries.length <= MAX_EXPIRY_SHARE
  ) {
    return [];
  }
  const share = Math.round((best.count / entries.length) * 100);
  return [
    recordIssue(
      'warning',
      'employment-dates',
      'employment',
      first.key,
      first.merged,
      ['endsOn'],
      `${String(best.count)} of ${String(entries.length)} contracts (${String(share)}%) end between ${first.endsOn} and ${last.endsOn}; spread expiries so no ${String(EXPIRY_WINDOW_DAYS)}-day window holds more than ${String(MAX_EXPIRY_SHARE * 100)}% of them`,
    ),
  ];
}

function checkDates(
  key: string,
  merged: MergedRecordOf<'employment'>,
  start: GameDate,
): ValidationIssue[] {
  const employment = merged.record;
  const issues: ValidationIssue[] = [];
  if (compareDates(employment.startsOn, start) > 0) {
    issues.push(
      recordIssue(
        'error',
        'employment-dates',
        'employment',
        key,
        merged,
        ['startsOn'],
        `Contract ${key} starts on ${employment.startsOn}, after the world starts on ${start}`,
      ),
    );
  }
  if (employment.endsOn !== null && compareDates(employment.endsOn, employment.startsOn) <= 0) {
    issues.push(
      recordIssue(
        'error',
        'employment-dates',
        'employment',
        key,
        merged,
        ['endsOn'],
        `Contract ${key} ends on ${employment.endsOn}, which is not after it starts on ${employment.startsOn}`,
      ),
    );
  } else if (employment.endsOn !== null && compareDates(employment.endsOn, start) <= 0) {
    issues.push(
      recordIssue(
        'error',
        'employment-dates',
        'employment',
        key,
        merged,
        ['endsOn'],
        `Contract ${key} ends on ${employment.endsOn}, before the world starts on ${start}; leave expired contracts out of the pack`,
      ),
    );
  }
  return issues;
}

export const employmentDates: ContentRule = {
  id: 'employment-dates',
  description:
    'Contracts start by the start date and end after it, nobody holds two exclusive contracts, and expiries are spread out',
  check(world, content) {
    const start = worldStartDate(world);
    const entries = sortedRecords(content, 'employment');
    const issues: ValidationIssue[] = entries.flatMap(([key, merged]) =>
      checkDates(key, merged, start),
    );

    const exclusiveByPerson = new Map<string, string>();
    for (const [key, merged] of entries) {
      const employment = merged.record;
      if (!employment.terms.exclusive || !isEmploymentActiveOn(employment, start)) {
        continue;
      }
      const personKey = refKey(employment.personKey);
      const earlier = exclusiveByPerson.get(personKey);
      if (earlier === undefined) {
        exclusiveByPerson.set(personKey, key);
        continue;
      }
      issues.push(
        recordIssue(
          'error',
          'employment-dates',
          'employment',
          key,
          merged,
          ['terms', 'exclusive'],
          `${personKey} already has an exclusive contract (${earlier}) running on ${start}`,
        ),
      );
    }

    issues.push(...expiryCluster(entries));
    return issues;
  },
};
