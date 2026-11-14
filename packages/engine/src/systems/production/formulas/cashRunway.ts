/**
 * Cash runway: how much money a promotion makes or loses in a month at its current rate, and how
 * many months its cash lasts if it keeps losing money.
 *
 * Design: docs/design/production.md#cash-runway. The month is built from two halves:
 *
 * - **Fixed spend, priced ahead** with the same formulas that post it: wages (the payroll a month),
 *   medical, the production, marketing and back office overhead, and the per-show production of
 *   the shows in the next `production.forecastDays`, turned into a month.
 * - **Everything else, from the ledger**: ticket sales, merchandise, TV money, venue rent, travel,
 *   catering and the rest over the last days played (at most `production.runway.lookbackDays`),
 *   turned into a month. One-off payments are left out. Before `production.runway.minDaysPlayed`
 *   days of play this half is left out too, and the runway waits.
 *
 * Months left = cash ÷ the money lost a month. A month is 365 ÷ 12 days.
 */

import { startCalc } from '../../../core/trace/calc';
import { inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';

export const CASH_RUNWAY_DOC_REF = 'docs/design/production.md#cash-runway';

/** Where the promotion stands: what the Finances and Production screens say about it. */
export type CashRunwayStatus =
  /** Not enough days played to count ticket sales and other show money yet. */
  | 'tooEarly'
  /** Money comes in at least as fast as it goes out. */
  | 'makingMoney'
  /** Losing money, with more months of cash left than the warning line. */
  | 'losingMoney'
  /** Losing money, with fewer months of cash left than `production.runway.warnBelowMonths`. */
  | 'runningOut'
  /** Cash is at or below 0: costs are still paid, so the debt grows. */
  | 'outOfCash';

/** Everything that is not priced ahead, as the ledger booked it lately. */
export interface RecentMoney {
  /** Signed cents over the days counted: income positive, costs negative. */
  net: number;
  /** How many days the amount covers (at least 1). */
  days: number;
}

export interface CashRunwayInputs {
  promotionName: string;
  /** Cash now, in cents. */
  cash: number;
  /** Wages a month (positive cents). */
  payroll: Traced<number>;
  /** Medical a month (positive cents). */
  medical: Traced<number>;
  /** Production, marketing and back office overhead a month (positive cents). */
  overhead: Traced<number>;
  /** Per-show production of the shows in the next `forecastDays` days (positive cents). */
  showProduction: Traced<number>;
  /** How many days ahead `showProduction` covers. */
  forecastDays: number;
  /** Other money lately, or null while too few days have been played to count it. */
  recent: RecentMoney | null;
}

export interface CashRunway {
  /** Money made (positive) or lost (negative) a month at this rate, in whole cents. */
  monthlyNet: Traced<number>;
  /**
   * How many months the cash lasts at this rate; null unless the promotion is losing money with
   * cash above 0 and enough days played.
   */
  monthsLeft: Traced<number> | null;
  status: CashRunwayStatus;
}

const DAYS_IN_YEAR = 365;
const MONTHS_IN_YEAR = 12;

/** `amount` over `days` days, as a month. */
function perMonth(label: string, amount: Traced<number>, days: number, daysLabel: string) {
  return startCalc(label, amount, { unit: 'money/month' })
    .divide(daysLabel, days)
    .multiply('Days in a year', DAYS_IN_YEAR)
    .divide('Months in a year', MONTHS_IN_YEAR)
    .done();
}

/** The month at this rate, and how long the cash lasts. */
export function cashRunway(
  inputs: CashRunwayInputs,
  deps: { tunables: EngineTunables },
): CashRunway {
  const { recent } = inputs;
  const other =
    recent === null
      ? inputOf('Ticket sales and other show money', 0, undefined, 'money/month')
      : perMonth(
          'Ticket sales and other show money a month',
          inputOf(
            `Income less other costs, last ${dayText(recent.days)}`,
            recent.net,
            undefined,
            'money',
          ),
          recent.days,
          'Days counted',
        );
  const calc = startCalc(`${inputs.promotionName} money a month at this rate`, other, {
    unit: 'money/month',
    docRef: CASH_RUNWAY_DOC_REF,
  });
  if (recent === null) {
    const minDays = calc.tunable(deps.tunables, 'production.runway.minDaysPlayed');
    calc.note(`Ticket sales and other show money count once ${dayText(minDays)} have been played`);
  }
  calc
    .subtract('Wages', inputs.payroll)
    .subtract('Medical', inputs.medical)
    .subtract('Production, marketing and back office overhead', inputs.overhead)
    .subtract(
      'Show production',
      perMonth(`Show production a month`, inputs.showProduction, inputs.forecastDays, 'Days ahead'),
    )
    .note('One-off payments (signing bonuses, severance, buyouts, upgrade fees) are left out');
  const monthlyNet = calc.round('round', 'Rounded to the cent').done();

  if (inputs.cash <= 0) {
    return { monthlyNet, monthsLeft: null, status: 'outOfCash' };
  }
  if (recent === null) {
    return { monthlyNet, monthsLeft: null, status: 'tooEarly' };
  }
  if (monthlyNet.value >= 0) {
    return { monthlyNet, monthsLeft: null, status: 'makingMoney' };
  }

  const loss = startCalc('Money lost a month', monthlyNet, { unit: 'money/month' })
    .multiply('As a loss', -1, 'Money going out counts as a loss')
    .done();
  const months = startCalc(
    `Months of cash left`,
    inputOf('Cash now', inputs.cash, undefined, 'money'),
    { unit: 'months', docRef: CASH_RUNWAY_DOC_REF },
  );
  months.divide('Money lost a month', loss);
  const warnBelow = months.tunable(deps.tunables, 'production.runway.warnBelowMonths');
  const runningOut = months.current < warnBelow;
  months.branch(`Fewer than ${String(warnBelow)} months left: warn`, runningOut);
  return {
    monthlyNet,
    monthsLeft: months.done(),
    status: runningOut ? 'runningOut' : 'losingMoney',
  };
}

function dayText(days: number): string {
  return days === 1 ? '1 day' : `${String(days)} days`;
}
