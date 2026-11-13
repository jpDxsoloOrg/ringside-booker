/**
 * Game dates and calendar arithmetic.
 *
 * This module is the only owner of game dates: it defines `GameDate`, parses it, and does all
 * calendar arithmetic. Everything else (phase cadences, event recurrences, contract lengths, ages,
 * display formatting) builds on these helpers instead of doing its own date maths.
 *
 * A `GameDate` is an ISO `YYYY-MM-DD` string in the proleptic Gregorian calendar, for years
 * 1900 to 2999. Strings keep saves readable and diffable, and because the format is fixed width,
 * comparing two dates as strings gives date order. Arithmetic converts to an epoch day number
 * (days since 1970-01-01) with pure integer civil-from-days maths, so there are no time zones,
 * no daylight saving and no JS `Date` anywhere.
 */

import { z } from 'zod';
import type { Brand } from './brand';
import { InvalidArgumentError, InvalidDateError } from './errors';

export type GameDate = Brand<string, 'GameDate'>;

/** Day of the week, 0 = Monday through 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Schema for a `Weekday` (0 = Monday .. 6 = Sunday). */
export const zWeekday = z.literal([0, 1, 2, 3, 4, 5, 6]);

/** Which occurrence of a weekday in a month: the first to fifth, or the last. */
export type WeekdayOrdinal = 1 | 2 | 3 | 4 | 5 | 'last';

export const MIN_GAME_YEAR = 1900;
export const MAX_GAME_YEAR = 2999;

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const GAME_DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 1970-01-01 was a Thursday, which is 3 when Monday is 0. */
const EPOCH_WEEKDAY = 3;
const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

/** True for Gregorian leap years: every 4th year, except centuries not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH_COMMON_YEAR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  assertYearAndMonth('daysInMonth', year, month);
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH_COMMON_YEAR[month - 1] ?? 0;
}

function assertYearAndMonth(functionName: string, year: number, month: number): void {
  if (!Number.isInteger(year) || year < MIN_GAME_YEAR || year > MAX_GAME_YEAR) {
    throw new InvalidArgumentError(
      functionName,
      'year',
      year,
      `an integer in ${String(MIN_GAME_YEAR)}..${String(MAX_GAME_YEAR)}`,
    );
  }
  if (!Number.isInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new InvalidArgumentError(functionName, 'month', month, 'an integer in 1..12');
  }
}

function assertWholeNumber(functionName: string, argumentName: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidArgumentError(functionName, argumentName, value, 'a whole number');
  }
}

/** Reads the parts of a string, or returns a reason it is not a valid game date. */
function readParts(value: string): CalendarParts | string {
  const match = GAME_DATE_FORMAT.exec(value);
  if (match === null) {
    return 'expected the form YYYY-MM-DD';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_GAME_YEAR || year > MAX_GAME_YEAR) {
    return `year must be ${String(MIN_GAME_YEAR)}-${String(MAX_GAME_YEAR)}`;
  }
  if (month < 1 || month > MONTHS_PER_YEAR) {
    return 'month must be 01-12';
  }
  const monthLength = daysInMonth(year, month);
  if (day < 1 || day > monthLength) {
    return `day must be 01-${String(monthLength)} in that month`;
  }
  return { year, month, day };
}

/** Parts of a value that is already a GameDate (the format was checked when it was branded). */
function partsOf(date: GameDate): CalendarParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/**
 * The single place parts become a GameDate. Callers have already range-checked the parts; the
 * final check is a cheap guard so a bug in the arithmetic can never brand a bad string.
 */
function formatParts(parts: CalendarParts): GameDate {
  const yearText = String(parts.year).padStart(4, '0');
  const monthText = String(parts.month).padStart(2, '0');
  const dayText = String(parts.day).padStart(2, '0');
  const text = `${yearText}-${monthText}-${dayText}`;
  if (!isGameDate(text)) {
    throw new InvalidDateError(text, 'calendar arithmetic produced an invalid date');
  }
  return text;
}

function assertYearInRange(functionName: string, parts: CalendarParts): void {
  if (parts.year < MIN_GAME_YEAR || parts.year > MAX_GAME_YEAR) {
    throw new InvalidDateError(
      `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}`,
      `${functionName} left the supported years ${String(MIN_GAME_YEAR)}-${String(MAX_GAME_YEAR)}`,
    );
  }
}

/** True when `value` is a valid game date string. */
export function isGameDate(value: unknown): value is GameDate {
  return typeof value === 'string' && typeof readParts(value) !== 'string';
}

/** Returns `value` as a GameDate, or throws `InvalidDateError` saying what is wrong with it. */
export function parseGameDate(value: unknown): GameDate {
  if (typeof value !== 'string') {
    throw new InvalidDateError(value, 'expected a string');
  }
  const parts = readParts(value);
  if (typeof parts === 'string') {
    throw new InvalidDateError(value, parts);
  }
  return formatParts(parts);
}

/** Builds a GameDate from a year, a month (1-12) and a day of the month. */
export function makeGameDate(year: number, month: number, day: number): GameDate {
  assertYearAndMonth('makeGameDate', year, month);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidDateError(
      `${String(year)}-${String(month)}-${String(day)}`,
      'day is not in that month',
    );
  }
  return formatParts({ year, month, day });
}

/**
 * Days since 1970-01-01 (negative before it). Uses the civil-from-days algorithm on a calendar
 * whose years start on 1 March, so the leap day is the last day of its year.
 */
export function toEpochDay(date: GameDate): number {
  const { year, month, day } = partsOf(date);
  const marchBasedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(marchBasedYear / 400);
  const yearOfEra = marchBasedYear - era * 400;
  const marchBasedMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * marchBasedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

const MIN_EPOCH_DAY = toEpochDay(formatParts({ year: MIN_GAME_YEAR, month: 1, day: 1 }));
const MAX_EPOCH_DAY = toEpochDay(formatParts({ year: MAX_GAME_YEAR, month: 12, day: 31 }));

/** The GameDate for a day number from `toEpochDay`. Throws when it is outside 1900-2999. */
export function fromEpochDay(epochDay: number): GameDate {
  assertWholeNumber('fromEpochDay', 'epochDay', epochDay);
  if (epochDay < MIN_EPOCH_DAY || epochDay > MAX_EPOCH_DAY) {
    throw new InvalidDateError(
      epochDay,
      `epoch day is outside the supported years ${String(MIN_GAME_YEAR)}-${String(MAX_GAME_YEAR)}`,
    );
  }
  const shiftedDay = epochDay + 719_468;
  const era = Math.floor(shiftedDay / 146_097);
  const dayOfEra = shiftedDay - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const marchBasedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * marchBasedMonth + 2) / 5) + 1;
  const month = marchBasedMonth < 10 ? marchBasedMonth + 3 : marchBasedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return formatParts({ year, month, day });
}

/** `date` moved by a whole number of days (negative moves back). */
export function addDays(date: GameDate, days: number): GameDate {
  assertWholeNumber('addDays', 'days', days);
  return fromEpochDay(toEpochDay(date) + days);
}

/**
 * `date` moved by a whole number of calendar months. When the target month is shorter, the day is
 * clamped to its last day: 2024-01-31 plus one month is 2024-02-29, and 2023-01-31 gives 2023-02-28.
 */
export function addMonths(date: GameDate, months: number): GameDate {
  assertWholeNumber('addMonths', 'months', months);
  const { year, month, day } = partsOf(date);
  const monthIndex = year * MONTHS_PER_YEAR + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
  const targetMonth = monthIndex - targetYear * MONTHS_PER_YEAR + 1;
  assertYearInRange('addMonths', { year: targetYear, month: targetMonth, day });
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return formatParts({ year: targetYear, month: targetMonth, day: targetDay });
}

/** `date` moved by a whole number of years. 29 February becomes 28 February in common years. */
export function addYears(date: GameDate, years: number): GameDate {
  assertWholeNumber('addYears', 'years', years);
  return addMonths(date, years * MONTHS_PER_YEAR);
}

/** Days from `from` to `to`: positive when `to` is later, negative when it is earlier. */
export function diffDays(from: GameDate, to: GameDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** -1 when `left` is earlier, 1 when it is later, 0 when equal. Usable as a sort comparator. */
export function compareDates(left: GameDate, right: GameDate): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/** True when `date` is strictly earlier than `other`. */
export function isBefore(date: GameDate, other: GameDate): boolean {
  return date < other;
}

/** True when `date` is strictly later than `other`. */
export function isAfter(date: GameDate, other: GameDate): boolean {
  return date > other;
}

/** True when `value` is a weekday number 0..6. */
export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function weekdayOfEpochDay(epochDay: number): Weekday {
  const index = (((epochDay + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  if (!isWeekday(index)) {
    throw new InvalidArgumentError('weekday', 'epochDay', epochDay, 'a whole number');
  }
  return index;
}

/** Day of the week of `date`, 0 = Monday .. 6 = Sunday. */
export function weekday(date: GameDate): Weekday {
  return weekdayOfEpochDay(toEpochDay(date));
}

/** Day of the month, 1-31. */
export function dayOfMonth(date: GameDate): number {
  return partsOf(date).day;
}

/** Month of the year, 1 = January .. 12 = December. */
export function month(date: GameDate): number {
  return partsOf(date).month;
}

/** The calendar year. */
export function year(date: GameDate): number {
  return partsOf(date).year;
}

/** The first day of `date`'s month. */
export function startOfMonth(date: GameDate): GameDate {
  const parts = partsOf(date);
  return formatParts({ year: parts.year, month: parts.month, day: 1 });
}

/** The last day of `date`'s month. */
export function endOfMonth(date: GameDate): GameDate {
  const parts = partsOf(date);
  return formatParts({
    year: parts.year,
    month: parts.month,
    day: daysInMonth(parts.year, parts.month),
  });
}

/** True when `date` is the last day of its month. */
export function isLastDayOfMonth(date: GameDate): boolean {
  const parts = partsOf(date);
  return parts.day === daysInMonth(parts.year, parts.month);
}

/**
 * The `occurrence`-th `targetWeekday` of a month, for example the 2nd Tuesday (`2`) or the last
 * Sunday (`'last'`). Returns null when the month has no such day, such as a 5th Monday in a month
 * with only four.
 */
export function nthWeekdayOfMonth(
  targetYear: number,
  targetMonth: number,
  targetWeekday: Weekday,
  occurrence: WeekdayOrdinal,
): GameDate | null {
  assertYearAndMonth('nthWeekdayOfMonth', targetYear, targetMonth);
  if (!isWeekday(targetWeekday)) {
    throw new InvalidArgumentError(
      'nthWeekdayOfMonth',
      'targetWeekday',
      targetWeekday,
      'a weekday 0..6',
    );
  }
  if (
    occurrence !== 'last' &&
    !(Number.isInteger(occurrence) && occurrence >= 1 && occurrence <= 5)
  ) {
    throw new InvalidArgumentError('nthWeekdayOfMonth', 'occurrence', occurrence, "1..5 or 'last'");
  }
  const monthLength = daysInMonth(targetYear, targetMonth);
  if (occurrence === 'last') {
    const lastDay = formatParts({ year: targetYear, month: targetMonth, day: monthLength });
    const lastDayEpoch = toEpochDay(lastDay);
    const daysBack =
      (weekdayOfEpochDay(lastDayEpoch) - targetWeekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    return fromEpochDay(lastDayEpoch - daysBack);
  }
  const firstDay = formatParts({ year: targetYear, month: targetMonth, day: 1 });
  const daysForward =
    (targetWeekday - weekdayOfEpochDay(toEpochDay(firstDay)) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const dayNumber = 1 + daysForward + (occurrence - 1) * DAYS_PER_WEEK;
  if (dayNumber > monthLength) {
    return null;
  }
  return formatParts({ year: targetYear, month: targetMonth, day: dayNumber });
}

/**
 * Whole years between `birth` and `today`; the age goes up on the birthday itself.
 *
 * Someone born on 29 February has their birthday on 1 March in common years: they are still the
 * old age on 28 February and one year older on 1 March. Throws when `today` is before `birth`.
 */
export function ageInYears(birth: GameDate, today: GameDate): number {
  if (isBefore(today, birth)) {
    throw new InvalidDateError(today, `ageInYears: today is before the birth date ${birth}`);
  }
  const birthParts = partsOf(birth);
  const todayParts = partsOf(today);
  const hadBirthdayThisYear =
    todayParts.month > birthParts.month ||
    (todayParts.month === birthParts.month && todayParts.day >= birthParts.day);
  return todayParts.year - birthParts.year - (hadBirthdayThisYear ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// Year-months
// ---------------------------------------------------------------------------------------------

/** A calendar month as `YYYY-MM`, the first seven characters of a GameDate. */
export type YearMonth = Brand<string, 'YearMonth'>;

/** The shape of a year-month: four digits, a dash and a month from 01 to 12. */
export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `value` is a `YYYY-MM` string for a month in years 1900-2999. */
export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== 'string' || !YEAR_MONTH_PATTERN.test(value)) {
    return false;
  }
  const yearNumber = Number(value.slice(0, 4));
  return yearNumber >= MIN_GAME_YEAR && yearNumber <= MAX_GAME_YEAR;
}

/** The month `date` falls in: `yearMonthOf('2028-02-29')` is `'2028-02'`. */
export function yearMonthOf(date: GameDate): YearMonth {
  const text = date.slice(0, 7);
  if (!isYearMonth(text)) {
    throw new InvalidDateError(date, 'yearMonthOf: not a game date');
  }
  return text;
}

/** `month` moved by a whole number of months (negative moves back): `'2027-12'` + 1 is `'2028-01'`. */
export function addYearMonths(month: YearMonth, months: number): YearMonth {
  assertWholeNumber('addYearMonths', 'months', months);
  return yearMonthOf(addMonths(firstDayOfYearMonth(month), months));
}

/** The first day of a year-month. */
export function firstDayOfYearMonth(month: YearMonth): GameDate {
  return formatParts({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)), day: 1 });
}
