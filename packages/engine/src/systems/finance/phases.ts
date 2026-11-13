/**
 * The finance system's day phases: wages every day, medical on the 1st of each month.
 *
 * Both run in the `money` group (after shows and settlement), visit every promotion that is not
 * closed in id order, and post through `postMoney` with a trace whose last step turns the cost
 * into the signed amount. A zero amount posts nothing. Neither draws random numbers. See
 * docs/design/finances.md#payroll and #medical.
 */

import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import { cents, type Cents } from '../../core/money';
import type { StepContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import type { LedgerCategory, LedgerRefs } from '../../model/entities/ledger-entry';
import type { Promotion } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { dailyWageAccrual } from './formulas/dailyWageAccrual';
import { MEDICAL_LEVEL_LABELS, monthlyMedical } from './formulas/monthlyMedical';
import { monthlyPayroll } from './formulas/monthlyPayroll';
import { medicalHeadcount, payrollLinesOf, type PayrollLine } from './payroll';
import { postMoney } from './post';

export const PAYROLL_PHASE_ID = 'finance.payroll';
export const MONTHLY_MEDICAL_PHASE_ID = 'finance.monthlyMedical';

/** Promotions still trading, in id order. */
function openPromotions(ctx: StepContext): readonly Promotion[] {
  return ctx.read.tables.promotions.values().filter((promotion) => promotion.status !== 'closed');
}

/** A cost as the signed amount the ledger stores: the trace's last step is "Cost". */
export function asCost(label: string, cost: Traced<number>): Traced<number> {
  return startCalc(label, cost, { unit: 'money' })
    .multiply('Cost', -1, 'Money paid out comes off the cash')
    .done();
}

/** Posts `cost` as a cost row (with `refs`, if given), or logs one line when it is 0. */
export function postCost(
  ctx: StepContext,
  promotionId: PromotionId,
  category: LedgerCategory,
  memo: string,
  cost: Traced<number>,
  refs?: Partial<LedgerRefs>,
): void {
  if (cost.value === 0) {
    ctx.log(`${promotionId}: ${memo} comes to 0, nothing posted`);
    return;
  }
  const trace = asCost(memo, cost);
  const amount: Cents = cents(trace.value);
  postMoney(ctx, {
    promotionId,
    category,
    amount,
    memo,
    trace,
    ...(refs === undefined ? {} : { refs }),
  });
}

/** A promotion's payroll on one day: who is on it, the monthly total and the day's wages. */
export interface PayrollFigures {
  readonly lines: readonly PayrollLine[];
  readonly monthly: Traced<number>;
  readonly daily: Traced<number>;
}

/**
 * The payroll of `promotion` on `date`. The payroll phase posts `daily`; `finance.overview` shows
 * the same figures, so the Overview card and the next Wages row agree.
 */
export function payrollFiguresOf(
  read: GameWorldView,
  promotion: Promotion,
  date: GameDate,
  tunables: EngineTunables,
): PayrollFigures {
  const lines = payrollLinesOf(read, promotion, date, tunables);
  const monthly = monthlyPayroll({ lines }, { tunables });
  return { lines, monthly, daily: dailyWageAccrual(monthly) };
}

/** Every day: one Wages row per promotion with anyone to pay. */
export const payrollPhase: PhaseDefinition = definePhase({
  id: PAYROLL_PHASE_ID,
  group: 'money',
  order: 10,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    for (const promotion of openPromotions(ctx)) {
      const { daily } = payrollFiguresOf(ctx.read, promotion, ctx.date, ctx.tunables);
      postCost(ctx, promotion.id, 'wages', 'Wages', daily);
    }
  },
});

/** On the 1st of each month: one Medical row per promotion, by its medical policy. */
export const monthlyMedicalPhase: PhaseDefinition = definePhase({
  id: MONTHLY_MEDICAL_PHASE_ID,
  group: 'money',
  order: 20,
  cadence: { kind: 'monthly', day: 1 },
  run: (ctx) => {
    for (const promotion of openPromotions(ctx)) {
      const level = promotion.policies.medical;
      const levelLabel = MEDICAL_LEVEL_LABELS[level];
      const lines = payrollLinesOf(ctx.read, promotion, ctx.date, ctx.tunables);
      const bill = monthlyMedical(
        { contracts: medicalHeadcount(lines), level, levelLabel },
        { tunables: ctx.tunables },
      );
      postCost(ctx, promotion.id, 'medical', `Medical (${levelLabel})`, bill);
    }
  },
});

export const financePhases: readonly PhaseDefinition[] = [payrollPhase, monthlyMedicalPhase];
