/**
 * Phase cadences: how often a scheduled job runs, and whether it runs on a given date.
 *
 * A cadence is one of four kinds: every day, one weekday each week, one day each month (a fixed
 * day 1-28 or the last day), or one fixed date each year. Cadences only read dates through the
 * helpers in `core/date.ts`, so they never touch JS `Date`, time zones or the date string itself.
 *
 * Ambiguous cadences are rejected when they are defined instead of being skipped at run time:
 * a monthly job on the 31st would quietly not run in seven months a year, and a yearly job on
 * 29 February would run once every four years. The author has to pick `'last'` or a real date.
 *
 * Design notes: docs/design/day-pipeline.md, "Calendar".
 */

import { z } from 'zod';
import {
  addDays,
  dayOfMonth,
  daysInMonth,
  isLastDayOfMonth,
  month,
  weekday,
  type GameDate,
  type Weekday,
} from '../date';
import { InvalidArgumentError, InvalidCadenceError } from '../errors';

/** Short weekday names used in phase definitions and data packs. */
export type WeekdayName = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Weekday names indexed by `Weekday` (the numbering of `weekday()`, 0 = Monday). This tuple is the
 * one mapping between the names and the numbers.
 */
export const WEEKDAY_NAMES = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const satisfies readonly WeekdayName[];

const WEEKDAY_BY_NAME: Readonly<Record<WeekdayName, Weekday>> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

const WEEKDAY_DISPLAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const MONTH_DISPLAY_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The highest fixed day a monthly cadence may use: the 28th exists in every month. */
export const MAX_MONTHLY_CADENCE_DAY = 28;

/**
 * Any common (non-leap) year in the supported range. Yearly cadences are checked against month
 * lengths in a common year, so 29 February is rejected.
 */
const COMMON_YEAR_FOR_VALIDATION = 2001;

const MONTHS_PER_YEAR = 12;

/** How often a phase runs. */
export type Cadence =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekly'; readonly weekday: WeekdayName }
  | { readonly kind: 'monthly'; readonly day: number | 'last' }
  | { readonly kind: 'yearly'; readonly month: number; readonly day: number };

/** The kinds of cadence, in the order they are documented. */
export const CADENCE_KINDS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

/** One reason a cadence is invalid: the field at fault, its value and what it should be. */
interface CadenceProblem {
  /** Field name as used in messages, for example `monthly.day`. */
  readonly field: string;
  /** Path of the field inside the cadence object, for schema issues. */
  readonly path: readonly string[];
  readonly value: unknown;
  readonly reason: string;
}

/** True when `value` is one of the weekday names. */
export function isWeekdayName(value: unknown): value is WeekdayName {
  return typeof value === 'string' && Object.hasOwn(WEEKDAY_BY_NAME, value);
}

/** The `Weekday` number (0 = Monday) for a weekday name. */
export function weekdayFromName(name: WeekdayName): Weekday {
  if (!isWeekdayName(name)) {
    throw new InvalidArgumentError(
      'weekdayFromName',
      'name',
      name,
      `one of ${WEEKDAY_NAMES.join(', ')}`,
    );
  }
  return WEEKDAY_BY_NAME[name];
}

/** The weekday name for a `Weekday` number (0 = Monday). */
export function weekdayName(dayOfWeek: Weekday): WeekdayName {
  const name = WEEKDAY_NAMES[dayOfWeek];
  if (!isWeekdayName(name)) {
    throw new InvalidArgumentError('weekdayName', 'dayOfWeek', dayOfWeek, 'a weekday 0..6');
  }
  return name;
}

function isWholeNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Finds the first problem with a monthly cadence's day, or null when it is valid. */
function monthlyDayProblem(day: unknown): CadenceProblem | null {
  if (day === 'last' || isWholeNumberInRange(day, 1, MAX_MONTHLY_CADENCE_DAY)) {
    return null;
  }
  return {
    field: 'monthly.day',
    path: ['day'],
    value: day,
    reason:
      `must be a whole number from 1 to ${String(MAX_MONTHLY_CADENCE_DAY)}, or 'last' for the ` +
      'final day of the month (days 29-31 are missing from some months, so a job on them would ' +
      "silently skip those months; use 'last' instead)",
  };
}

/** Finds the first problem with a yearly cadence's month and day, or null when they are valid. */
function yearlyDateProblem(cadenceMonth: unknown, day: unknown): CadenceProblem | null {
  if (!isWholeNumberInRange(cadenceMonth, 1, MONTHS_PER_YEAR)) {
    return {
      field: 'yearly.month',
      path: ['month'],
      value: cadenceMonth,
      reason: 'must be a whole number from 1 (January) to 12 (December)',
    };
  }
  const monthLength = daysInMonth(COMMON_YEAR_FOR_VALIDATION, cadenceMonth);
  if (isWholeNumberInRange(day, 1, monthLength)) {
    return null;
  }
  const monthName = MONTH_DISPLAY_NAMES[cadenceMonth - 1] ?? String(cadenceMonth);
  const leapDayHint =
    cadenceMonth === 2 && day === 29
      ? ' (29 February only exists in leap years, so the job would skip three years in four; ' +
        "use 28 February, 1 March, or a monthly 'last' cadence with a month check)"
      : '';
  return {
    field: 'yearly.day',
    path: ['day'],
    value: day,
    reason: `must be a whole number from 1 to ${String(monthLength)} for ${monthName}${leapDayHint}`,
  };
}

/** Finds the first problem with a cadence, or null when it is valid. Works on unchecked input. */
function cadenceProblem(cadence: Cadence): CadenceProblem | null {
  const kind: unknown = cadence.kind;
  switch (cadence.kind) {
    case 'daily':
      return null;
    case 'weekly':
      return isWeekdayName(cadence.weekday)
        ? null
        : {
            field: 'weekly.weekday',
            path: ['weekday'],
            value: cadence.weekday,
            reason: `must be one of ${WEEKDAY_NAMES.join(', ')}`,
          };
    case 'monthly':
      return monthlyDayProblem(cadence.day);
    case 'yearly':
      return yearlyDateProblem(cadence.month, cadence.day);
    default:
      return {
        field: 'kind',
        path: ['kind'],
        value: kind,
        reason: `must be one of ${CADENCE_KINDS.join(', ')}`,
      };
  }
}

function assertValidCadence(cadence: Cadence): void {
  const problem = cadenceProblem(cadence);
  if (problem !== null) {
    throw new InvalidCadenceError(problem.field, problem.value, problem.reason);
  }
}

/**
 * Checks a cadence and returns a frozen copy of it. Throws `InvalidCadenceError`, naming the bad
 * field, when a monthly day is not 1-28 or `'last'`, a yearly month is not 1-12, or a yearly day
 * does not exist in that month in a common year (so 29 February is rejected).
 */
export function defineCadence(cadence: Cadence): Cadence {
  assertValidCadence(cadence);
  switch (cadence.kind) {
    case 'daily':
      return Object.freeze({ kind: 'daily' });
    case 'weekly':
      return Object.freeze({ kind: 'weekly', weekday: cadence.weekday });
    case 'monthly':
      return Object.freeze({ kind: 'monthly', day: cadence.day });
    case 'yearly':
      return Object.freeze({ kind: 'yearly', month: cadence.month, day: cadence.day });
  }
}

/**
 * True when a job with this cadence runs on `date`. Throws `InvalidCadenceError` for a cadence
 * `defineCadence` would reject, so an ambiguous cadence can never silently skip days.
 */
export function matchesCadence(date: GameDate, cadence: Cadence): boolean {
  assertValidCadence(cadence);
  switch (cadence.kind) {
    case 'daily':
      return true;
    case 'weekly':
      return weekday(date) === weekdayFromName(cadence.weekday);
    case 'monthly':
      return cadence.day === 'last' ? isLastDayOfMonth(date) : dayOfMonth(date) === cadence.day;
    case 'yearly':
      return month(date) === cadence.month && dayOfMonth(date) === cadence.day;
  }
}

/** Days `nextOccurrence` looks at: one leap year, which every valid cadence repeats within. */
const MAX_OCCURRENCE_SEARCH_DAYS = 366;

/**
 * The first date on or after `from` when a job with this cadence runs, for reports such as
 * "next payroll on 2024-03-29". Looks at most 366 days ahead and throws if nothing matches.
 */
export function nextOccurrence(from: GameDate, cadence: Cadence): GameDate {
  assertValidCadence(cadence);
  for (let offset = 0; offset < MAX_OCCURRENCE_SEARCH_DAYS; offset += 1) {
    const candidate = addDays(from, offset);
    if (matchesCadence(candidate, cadence)) {
      return candidate;
    }
  }
  throw new InvalidArgumentError(
    'nextOccurrence',
    'cadence',
    describeCadence(cadence),
    `a cadence that runs within ${String(MAX_OCCURRENCE_SEARCH_DAYS)} days of ${from}`,
  );
}

/** English ordinal for a day of the month: 1st, 2nd, 3rd, 4th, ..., 21st, 22nd, 23rd, 24th. */
function ordinal(dayNumber: number): string {
  const lastTwoDigits = dayNumber % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${String(dayNumber)}th`;
  }
  switch (dayNumber % 10) {
    case 1:
      return `${String(dayNumber)}st`;
    case 2:
      return `${String(dayNumber)}nd`;
    case 3:
      return `${String(dayNumber)}rd`;
    default:
      return `${String(dayNumber)}th`;
  }
}

/**
 * The cadence in plain English for day reports and traces: "every day", "every Monday",
 * "on the 1st of each month", "on the last day of each month", "every year on 1 January".
 */
export function describeCadence(cadence: Cadence): string {
  assertValidCadence(cadence);
  switch (cadence.kind) {
    case 'daily':
      return 'every day';
    case 'weekly':
      return `every ${WEEKDAY_DISPLAY_NAMES[weekdayFromName(cadence.weekday)]}`;
    case 'monthly':
      return cadence.day === 'last'
        ? 'on the last day of each month'
        : `on the ${ordinal(cadence.day)} of each month`;
    case 'yearly': {
      const monthName = MONTH_DISPLAY_NAMES[cadence.month - 1] ?? String(cadence.month);
      return `every year on ${String(cadence.day)} ${monthName}`;
    }
  }
}

/** Adds the shared cadence check to a schema, reporting the same field and reason as the error. */
function refineCadence(cadence: Cadence, context: z.RefinementCtx): void {
  const problem = cadenceProblem(cadence);
  if (problem !== null) {
    context.addIssue({
      code: 'custom',
      path: [...problem.path],
      message: `${problem.field} ${problem.reason}`,
      input: problem.value,
    });
  }
}

/**
 * Schema for a cadence in data packs and saved schedules. It applies the same checks as
 * `defineCadence`, so anything it accepts can be passed to the other cadence functions.
 */
export const cadenceSchema: z.ZodType<Cadence> = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('daily') }),
    z.strictObject({ kind: z.literal('weekly'), weekday: z.enum(WEEKDAY_NAMES) }),
    z.strictObject({ kind: z.literal('monthly'), day: z.union([z.number(), z.literal('last')]) }),
    z.strictObject({ kind: z.literal('yearly'), month: z.number(), day: z.number() }),
  ])
  .superRefine(refineCadence);
