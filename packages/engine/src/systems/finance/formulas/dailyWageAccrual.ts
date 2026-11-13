/**
 * Daily wages: a month's payroll spread evenly over the year.
 *
 * Design: docs/design/finances.md#payroll. Monthly payroll × 12 ÷ 365.25, rounded to the nearest
 * cent, so a year of daily rows comes to twelve months of wages (within a cent a day) whether or
 * not the year has a leap day. The Why? reads "Monthly payroll $924,000 × 12 ÷ 365.25 =
 * $30,357.29".
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';

export const DAILY_WAGE_DOC_REF = 'docs/design/finances.md#payroll';

/** Months in a year. */
export const MONTHS_PER_YEAR = 12;
/** The average length of a year, leap years included. */
export const AVERAGE_DAYS_PER_YEAR = 365.25;

/**
 * One day's wages, in whole cents (unit `money`), from a traced monthly payroll. The exact result
 * never ends in half a cent (365.25 × 4 is odd), so rounding to the nearest cent matches `mulRatio`.
 * It reads no tunable of its own: the multiplier is already in the monthly payroll.
 */
export function dailyWageAccrual(monthly: Traced<number>): Traced<number> {
  return startCalc('Daily wages', monthly, { unit: 'money', docRef: DAILY_WAGE_DOC_REF })
    .multiply(
      'Months in a year',
      constantOf('Months in a year', MONTHS_PER_YEAR, 'A year always has twelve months'),
    )
    .divide(
      'Average days in a year',
      constantOf(
        'Average days in a year',
        AVERAGE_DAYS_PER_YEAR,
        'Average days in a year, leap years included',
      ),
    )
    .round('round', 'Rounded to the nearest cent')
    .done();
}
