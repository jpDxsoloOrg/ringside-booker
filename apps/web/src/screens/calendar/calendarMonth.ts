import {
  addDays,
  addMonths,
  compareDates,
  endOfMonth,
  makeGameDate,
  MAX_GAME_YEAR,
  MIN_GAME_YEAR,
  month as monthOf,
  startOfMonth,
  weekday,
  year as yearOf,
} from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { formatGameDate } from '@/components/format';

/**
 * The calendar's month maths: which days a month view shows, how shows group onto them, and the
 * `YYYY-MM` form a month takes in the URL. Pure, and built on the engine's date helpers, so a
 * month is the same on the grid, in the agenda and in a link.
 *
 * A week starts on Monday: the game's weekday 0.
 */

const DAYS_PER_WEEK = 7;
const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * The first and last year a month view can show. The years at the very ends of the game calendar
 * are left out, so a view's leading and trailing days always exist.
 */
export const FIRST_CALENDAR_YEAR = MIN_GAME_YEAR + 1;
export const LAST_CALENDAR_YEAR = MAX_GAME_YEAR - 1;

/** Column headings of the month grid, Monday first, with the full names for screen readers. */
export const WEEKDAY_HEADINGS: readonly { readonly short: string; readonly full: string }[] = [
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
  { short: 'Sun', full: 'Sunday' },
];

function isCalendarYear(year: number): boolean {
  return year >= FIRST_CALENDAR_YEAR && year <= LAST_CALENDAR_YEAR;
}

/** The first day of the month a `YYYY-MM` URL value names, or null when it names none. */
export function parseMonthParam(value: string | null): GameDate | null {
  const match = value === null ? null : MONTH_PARAM_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!isCalendarYear(year) || monthNumber < 1 || monthNumber > 12) return null;
  return makeGameDate(year, monthNumber, 1);
}

/** The `YYYY-MM` URL value of the month `date` is in. */
export function monthParamOf(date: GameDate): string {
  return `${String(yearOf(date)).padStart(4, '0')}-${String(monthOf(date)).padStart(2, '0')}`;
}

/** True when both dates are in the same month of the same year. */
export function isSameMonth(left: GameDate, right: GameDate): boolean {
  return yearOf(left) === yearOf(right) && monthOf(left) === monthOf(right);
}

/**
 * The first day of the month `months` after (or, negative, before) the month of `date`, or null
 * when that month is outside what the calendar shows.
 */
export function shiftMonth(date: GameDate, months: number): GameDate | null {
  const first = startOfMonth(date);
  const targetIndex = yearOf(first) * 12 + (monthOf(first) - 1) + months;
  if (!isCalendarYear(Math.floor(targetIndex / 12))) return null;
  return addMonths(first, months);
}

/**
 * The weeks a month view shows, each Monday to Sunday: from the Monday on or before the 1st to the
 * Sunday on or after the last day. Four, five or six weeks, so 28, 35 or 42 days; the days outside
 * the month belong to its neighbours.
 */
export function monthWeeks(month: GameDate): GameDate[][] {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const gridStart = addDays(first, -weekday(first));
  const gridEnd = addDays(last, DAYS_PER_WEEK - 1 - weekday(last));
  const weeks: GameDate[][] = [];
  for (
    let monday = gridStart;
    compareDates(monday, gridEnd) <= 0;
    monday = addDays(monday, DAYS_PER_WEEK)
  ) {
    weeks.push(Array.from({ length: DAYS_PER_WEEK }, (_, offset) => addDays(monday, offset)));
  }
  return weeks;
}

/** Rows grouped by their `date`, each group in the order the rows came in. */
export function groupByDate<Row extends { readonly date: GameDate }>(
  rows: readonly Row[],
): ReadonlyMap<GameDate, readonly Row[]> {
  const groups = new Map<GameDate, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.date);
    if (group === undefined) {
      groups.set(row.date, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

/** The heading of a week in the agenda: "Week of Mon 4 Jan". */
export function weekLabel(monday: GameDate): string {
  return `Week of ${formatGameDate(monday, 'dayMonth')}`;
}

const monthTitleFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

/** The month's name with its year: "January 2027". */
export function monthTitle(month: GameDate): string {
  return monthTitleFormat.format(new Date(Date.UTC(yearOf(month), monthOf(month) - 1, 1)));
}
