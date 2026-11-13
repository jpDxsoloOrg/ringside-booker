/**
 * Dates as the Office's Why? lines print them: "Mon 11 Jan", with the year when it differs from
 * today's ("Mon 29 Dec 2025"). Dates only; the game has no time of day.
 */

import { dayOfMonth, month, weekday, year, type GameDate } from '../../../core/date';

const WEEKDAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Mon 11 Jan", or "Mon 29 Dec 2025" when `date` falls in another year than `today`. */
export function officeDateText(date: GameDate, today: GameDate): string {
  const text = `${WEEKDAY_SHORT_NAMES[weekday(date)]} ${String(dayOfMonth(date))} ${MONTH_SHORT_NAMES[month(date) - 1] ?? ''}`;
  return year(date) === year(today) ? text : `${text} ${String(year(date))}`;
}
