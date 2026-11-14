/**
 * Days held: how long a reign has lasted.
 *
 * Design: docs/design/titles.md#days-held. A reign counts from the day it was won up to, not
 * including, the day it ended (docs/design/data-model.md, Title reigns), so a reign won today, or
 * won and lost on the same show, reads 0 days; the UI words 0 as "Won today". An open reign counts
 * to today. Never negative.
 */

import { dayOfMonth, diffDays, month, year, type GameDate } from '../../../core/date';
import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';

export const REIGN_DAYS_DOC_REF = 'docs/design/titles.md#days-held';
export const REIGN_DAYS_NOTE =
  'A reign counts from the day it was won up to, not including, the day it ended';

export interface ReignDaysInputs {
  readonly wonOn: GameDate;
  /** Null while the reign is current. */
  readonly lostOn: GameDate | null;
  readonly today: GameDate;
}

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

/** "4 Jan 2027". */
export function reignDateText(date: GameDate): string {
  return `${String(dayOfMonth(date))} ${MONTH_SHORT_NAMES[month(date) - 1] ?? ''} ${String(year(date))}`;
}

/** `max(0, diffDays(wonOn, lostOn ?? today))`. */
/** Days held reads no tunables, so it takes no deps. */
export function reignDays(inputs: ReignDaysInputs): Traced<number> {
  const end = inputs.lostOn ?? inputs.today;
  const endText = inputs.lostOn === null ? 'today' : reignDateText(inputs.lostOn);
  return startCalc('Days held', diffDays(inputs.wonOn, end), {
    unit: 'days',
    docRef: REIGN_DAYS_DOC_REF,
    startLabel: `From ${reignDateText(inputs.wonOn)} to ${endText}`,
  })
    .max('Not below 0', 0)
    .note(REIGN_DAYS_NOTE)
    .done();
}
