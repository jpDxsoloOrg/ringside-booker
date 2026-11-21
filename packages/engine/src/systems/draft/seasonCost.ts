/**
 * What a draft pick's contract costs for the whole season (DRF-10), paid up front at the pick.
 *
 * - **Wages** = monthly wage × `finance.wages.multiplier` × 12 × days ÷ 365.25: the same daily
 *   accrual payroll would charge (`finance/formulas/dailyWageAccrual.ts`), over the days from the
 *   pick to the contract's end. Rounded to the cent.
 * - **Appearances** = days ÷ 7 × `draft.cost.appearancesPerWeek`, rounded, and no more than the
 *   contract's appearance cap. The default is one appearance a week: one per weekly show, the
 *   schedule every draft game starts on. Only counted when the deal has a fee.
 * - **Fees** = per-appearance fee × appearances.
 * - **Total** = wages + fees.
 *
 * Pure: plain numbers in, plain numbers out; {@link seasonCostTrace} explains a result for the
 * ledger row's Why?.
 *
 * Design: docs/design/draft.md#season-cost.
 */

import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import { AVERAGE_DAYS_PER_YEAR, MONTHS_PER_YEAR } from '../finance/formulas/dailyWageAccrual';
import { moneyText } from '../production/formulas/shared';

export const SEASON_COST_DOC_REF = 'docs/design/draft.md#season-cost';

const DAYS_PER_WEEK = 7;

export interface SeasonCostInputs {
  /** The contract's monthly wage, in cents (0 on a per-appearance deal). */
  readonly monthlyWage: number;
  /** The contract's per-appearance fee, in cents (0 on a written deal). */
  readonly perAppearanceFee: number;
  /** Most appearances a year the contract allows, or null for no cap. */
  readonly appearanceCap: number | null;
  /** Days from the pick to the contract's end (its `endsOn`, the first day not covered). */
  readonly days: number;
  /** Expected appearances a week (`draft.cost.appearancesPerWeek`). */
  readonly appearancesPerWeek: number;
  /** `finance.wages.multiplier`, as payroll applies it. */
  readonly wageMultiplier: number;
}

/** A season contract's cost, in whole cents. */
export interface SeasonCost {
  readonly days: number;
  readonly wages: number;
  readonly appearances: number;
  readonly fees: number;
  readonly total: number;
}

/** The season cost of one contract. */
export function seasonCost(inputs: SeasonCostInputs): SeasonCost {
  const days = Math.max(0, Math.floor(inputs.days));
  const wages = Math.round(
    (inputs.monthlyWage * inputs.wageMultiplier * MONTHS_PER_YEAR * days) / AVERAGE_DAYS_PER_YEAR,
  );
  let appearances = 0;
  if (inputs.perAppearanceFee > 0) {
    appearances = Math.round((days / DAYS_PER_WEEK) * Math.max(0, inputs.appearancesPerWeek));
    if (inputs.appearanceCap !== null) {
      appearances = Math.min(appearances, inputs.appearanceCap);
    }
  }
  const fees = inputs.perAppearanceFee * appearances;
  return { days, wages, appearances, fees, total: wages + fees };
}

/** The cost as a Why? trace whose value is `cost.total`. */
export function seasonCostTrace(
  label: string,
  inputs: SeasonCostInputs,
  cost: SeasonCost,
): Traced<number> {
  const calc = startCalc(label, 0, {
    unit: 'money',
    docRef: SEASON_COST_DOC_REF,
    startLabel: 'Nothing yet',
  });
  if (cost.wages > 0) {
    calc.add(
      `Wage of ${moneyText(inputs.monthlyWage)} a month for ${String(cost.days)} days`,
      cost.wages,
    );
  }
  if (cost.fees > 0) {
    calc.add(
      `${String(cost.appearances)} expected appearances at ${moneyText(inputs.perAppearanceFee)} each`,
      cost.fees,
    );
  }
  calc.note(
    `Paid up front for the season: ${String(cost.days)} days, ${String(inputs.appearancesPerWeek)} expected appearance(s) a week`,
  );
  return calc.done();
}
