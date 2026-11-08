/**
 * When a recurring show runs.
 *
 * `occursOn` answers "is there a show on this date?" and `nextOccurrence` finds the first show
 * date after a given day. Both are pure and read dates only through `core/date.ts`, so they never
 * touch JS `Date` or time zones. The calendar (EVT/DAY epics) uses them to create dated event
 * instances from definitions.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import {
  diffDays,
  fromEpochDay,
  isAfter,
  makeGameDate,
  MAX_GAME_YEAR,
  month,
  nthWeekdayOfMonth,
  toEpochDay,
  weekday,
  year,
  type GameDate,
} from '../core/date';
import type { Recurrence } from './entities/event-definition';
import type { DeepReadonly } from './world';

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const LAST_EPOCH_DAY = toEpochDay(makeGameDate(MAX_GAME_YEAR, 12, 31));

/** A recurrence as stored on a row, or as a freshly built value. */
export type RecurrenceView = DeepReadonly<Recurrence>;

/** The date `days` after `date`, or null when that falls after the last supported game date. */
function addDaysWithinRange(date: GameDate, days: number): GameDate | null {
  const epochDay = toEpochDay(date) + days;
  return epochDay > LAST_EPOCH_DAY ? null : fromEpochDay(epochDay);
}

/** True when `recurrence` puts a show on `date`. */
export function occursOn(recurrence: RecurrenceView, date: GameDate): boolean {
  switch (recurrence.kind) {
    case 'weekly':
      return recurrence.weekdays.includes(weekday(date));
    case 'everyNWeeks': {
      const daysSinceAnchor = diffDays(recurrence.anchor, date);
      return (
        daysSinceAnchor >= 0 && daysSinceAnchor % (DAYS_PER_WEEK * recurrence.intervalWeeks) === 0
      );
    }
    case 'monthly':
      return (
        nthWeekdayOfMonth(year(date), month(date), recurrence.weekday, recurrence.week) === date
      );
    case 'annual':
      return (
        month(date) === recurrence.month &&
        nthWeekdayOfMonth(year(date), recurrence.month, recurrence.weekday, recurrence.week) ===
          date
      );
    case 'dates':
      return recurrence.dates.includes(date);
  }
}

function nextWeekly(weekdays: readonly number[], after: GameDate): GameDate | null {
  for (let offset = 1; offset <= DAYS_PER_WEEK; offset += 1) {
    const candidate = addDaysWithinRange(after, offset);
    if (candidate === null) {
      return null;
    }
    if (weekdays.includes(weekday(candidate))) {
      return candidate;
    }
  }
  return null;
}

function nextEveryNWeeks(
  recurrence: DeepReadonly<Extract<Recurrence, { kind: 'everyNWeeks' }>>,
  after: GameDate,
): GameDate | null {
  if (isAfter(recurrence.anchor, after)) {
    return recurrence.anchor;
  }
  const periodDays = DAYS_PER_WEEK * recurrence.intervalWeeks;
  const periodsPassed = Math.floor(diffDays(recurrence.anchor, after) / periodDays) + 1;
  return addDaysWithinRange(recurrence.anchor, periodsPassed * periodDays);
}

/**
 * The first date strictly after `after` on which the monthly rule `occurrenceIn(year, month)`
 * falls, looking at `after`'s month and then later months `stepMonths` apart.
 */
function nextByMonth(
  after: GameDate,
  firstMonth: { readonly year: number; readonly month: number },
  stepMonths: number,
  occurrenceIn: (targetYear: number, targetMonth: number) => GameDate | null,
): GameDate | null {
  // Two candidates always suffice: the rule falls exactly once in every candidate month, so when
  // the first candidate's date is not after `after`, the next candidate's date is.
  for (let step = 0; step < 2; step += 1) {
    const monthIndex =
      firstMonth.year * MONTHS_PER_YEAR + (firstMonth.month - 1) + step * stepMonths;
    const targetYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
    const targetMonth = (monthIndex % MONTHS_PER_YEAR) + 1;
    if (targetYear > MAX_GAME_YEAR) {
      return null;
    }
    const candidate = occurrenceIn(targetYear, targetMonth);
    if (candidate !== null && isAfter(candidate, after)) {
      return candidate;
    }
  }
  return null;
}

/**
 * The first date strictly after `after` on which `recurrence` puts a show, or null when there is
 * none: a `dates` list with no later date, or a next show past the last supported game date.
 * An `everyNWeeks` recurrence never occurs before its anchor, so the anchor itself is the answer
 * for any earlier `after`.
 */
export function nextOccurrence(recurrence: RecurrenceView, after: GameDate): GameDate | null {
  switch (recurrence.kind) {
    case 'weekly':
      return nextWeekly(recurrence.weekdays, after);
    case 'everyNWeeks':
      return nextEveryNWeeks(recurrence, after);
    case 'monthly':
      return nextByMonth(
        after,
        { year: year(after), month: month(after) },
        1,
        (targetYear, targetMonth) =>
          nthWeekdayOfMonth(targetYear, targetMonth, recurrence.weekday, recurrence.week),
      );
    case 'annual':
      return nextByMonth(
        after,
        { year: year(after), month: recurrence.month },
        MONTHS_PER_YEAR,
        (targetYear, targetMonth) =>
          nthWeekdayOfMonth(targetYear, targetMonth, recurrence.weekday, recurrence.week),
      );
    case 'dates':
      return recurrence.dates.find((date) => isAfter(date, after)) ?? null;
  }
}
