/**
 * A recurrence in words, for the show sheet and anywhere else a schedule is described: "Every
 * Monday", "Last Sunday of every month".
 *
 * The wording names weekdays, weeks and months only. A show has no clock time and no length
 * (design decision D-10), so neither ever appears here.
 *
 * Design notes: docs/design/calendar.md#queries.
 */

import type { Weekday } from '../../core/date';
import type { RecurrenceWeek } from '../../model/entities/event-definition';
import type { RecurrenceView } from '../../model/recurrence';

const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  0: 'Monday',
  1: 'Tuesday',
  2: 'Wednesday',
  3: 'Thursday',
  4: 'Friday',
  5: 'Saturday',
  6: 'Sunday',
};

const MONTH_NAMES = [
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

const WEEK_NAMES: Readonly<Record<RecurrenceWeek, string>> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
  last: 'Last',
};

const DAYS_PER_WEEK = 7;

/** "Monday", "Monday and Friday", "Monday, Wednesday and Friday". */
function joinWithAnd(words: readonly string[]): string {
  if (words.length <= 1) {
    return words.join('');
  }
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/**
 * How often a show runs, in words:
 *
 * - weekly: "Every Monday", "Every Monday and Thursday", or "Every day" for all seven;
 * - every N weeks: "Every 2 weeks on Saturday";
 * - monthly: "Last Sunday of every month";
 * - annual: "2nd Sunday of February every year";
 * - set dates: "On 1 set date", "On 4 set dates".
 *
 * Weekdays are listed Monday first, whatever order the recurrence stores them in.
 */
export function recurrenceText(recurrence: RecurrenceView): string {
  switch (recurrence.kind) {
    case 'weekly': {
      if (recurrence.weekdays.length === DAYS_PER_WEEK) {
        return 'Every day';
      }
      const names = [...recurrence.weekdays]
        .sort((left, right) => left - right)
        .map((weekday) => WEEKDAY_NAMES[weekday]);
      return `Every ${joinWithAnd(names)}`;
    }
    case 'everyNWeeks':
      return `Every ${String(recurrence.intervalWeeks)} weeks on ${WEEKDAY_NAMES[recurrence.weekday]}`;
    case 'monthly':
      return `${WEEK_NAMES[recurrence.week]} ${WEEKDAY_NAMES[recurrence.weekday]} of every month`;
    case 'annual': {
      const monthName = MONTH_NAMES[recurrence.month - 1] ?? '';
      return `${WEEK_NAMES[recurrence.week]} ${WEEKDAY_NAMES[recurrence.weekday]} of ${monthName} every year`;
    }
    case 'dates':
      return recurrence.dates.length === 1
        ? 'On 1 set date'
        : `On ${String(recurrence.dates.length)} set dates`;
  }
}
