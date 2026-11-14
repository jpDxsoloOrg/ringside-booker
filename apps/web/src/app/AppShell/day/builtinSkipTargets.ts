import { addDays, addMonths, diffDays, startOfMonth } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { formatGameDate } from '@/components/format';
import { dayCount } from './advanceSummaryText';
import { registerSkipTarget } from './skipTargets';
import type { SkipTarget, SkipTargetChoice } from './skipTargets';

/**
 * The Skip days sheet's own quick choices (DAY1-05): 7, 30 and 90 days, and until the 1st of next
 * month. Imported once by `SkipDaysSheet.tsx`. Orders 5 (EVT1's "Until next show") and 50
 * (DAY3's "Until season end") are left for those features to register from their own folders.
 */

/** The first day of the month after `today`: 31 January gives 1 February. */
export function nextMonthStart(today: GameDate): GameDate {
  return startOfMonth(addMonths(today, 1));
}

/** `{ maxDays: days }`, "to Mon 1 Feb 2027". */
export function daysChoice(today: GameDate, days: number): SkipTargetChoice {
  return {
    request: { maxDays: days },
    detail: `to ${formatGameDate(addDays(today, days), 'dayMonthYear')}`,
  };
}

/** Skips to the 1st of next month and stops there: "Mon 1 Feb 2027 · 1 day". */
export function nextMonthChoice(today: GameDate): SkipTargetChoice {
  const stopAtDate = nextMonthStart(today);
  const days = diffDays(today, stopAtDate);
  return {
    request: { maxDays: days, stopAtDate },
    detail: `${formatGameDate(stopAtDate, 'dayMonthYear')} · ${dayCount(days)}`,
  };
}

function daysTarget(days: number, order: number): SkipTarget {
  return {
    id: `days.${String(days)}`,
    label: dayCount(days),
    order,
    useResolve: (today) => daysChoice(today, days),
  };
}

export const BUILTIN_SKIP_TARGETS: readonly SkipTarget[] = [
  daysTarget(7, 10),
  daysTarget(30, 20),
  daysTarget(90, 30),
  {
    id: 'month.next',
    label: 'Until the 1st of next month',
    order: 40,
    useResolve: nextMonthChoice,
  },
];

for (const target of BUILTIN_SKIP_TARGETS) {
  registerSkipTarget(target);
}
