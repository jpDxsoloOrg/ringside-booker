/**
 * WRK1's availability as one line of text for the Match lab and the segment warnings: the reason
 * `availabilityOf` gives, with the day the person is back when there is one ("On personal leave
 * until 12 Mar", "Injured (arm injury) until 1 May; can still do talking segments").
 *
 * Design: docs/design/match-rating.md#warnings.
 */

import { dayOfMonth, month, year, type GameDate } from '../../core/date';
import type { Availability } from '../workers/helpers/availability';

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

/** "12 Mar", or "12 Mar 2027" when `date` falls in another year than `today`. */
export function shortDayText(date: GameDate, today: GameDate): string {
  const dayMonth = `${String(dayOfMonth(date))} ${MONTH_SHORT_NAMES[month(date) - 1] ?? ''}`;
  return year(date) === year(today) ? dayMonth : `${dayMonth} ${String(year(date))}`;
}

/**
 * The reason with its end date. `until` is WRK1's first day back; a debut still ahead reads as
 * "Debuts 12 Mar" rather than "until".
 */
export function availabilityText(availability: Availability, today: GameDate): string {
  const { reason, until, status } = availability;
  if (until === null || status === 'available') {
    return reason;
  }
  const day = shortDayText(until, today);
  if (status === 'notDebuted') {
    return `${reason} (debuts ${day})`;
  }
  // "Injured (leg injury); can still do talking segments": the date goes before the extra clause.
  const split = reason.indexOf(';');
  return split === -1
    ? `${reason} until ${day}`
    : `${reason.slice(0, split)} until ${day}${reason.slice(split)}`;
}
