/**
 * The finance system: the economy's spine.
 *
 * During play there is exactly one way a promotion's cash changes: `postMoney` (`post.ts`). It
 * checks the amount, appends a ledger row, moves the cash in the same transaction, records the
 * row's Why? trace and publishes `finance.moneyPosted`, so the ledger always sums to the change in
 * cash. ECO1-03 adds the daily payroll and monthly medical phases, the cash Why? and the books
 * queries; the rest is filled in by ECO1-02..04. See
 * docs/design/finances.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { companyQuery } from './queries/company';
import { financePhases } from './phases';
import { financeBookQueries } from './queries/books';

export { LEDGER_CATEGORY_LABELS, ledgerCategoryKind, type LedgerCategoryKind } from './categories';
export { postMoney, POST_MONEY_MEMO_MAX, type PostMoneyInput } from './post';
export {
  CASH_TRACE_KIND,
  FINANCE_TRACE_KINDS,
  LEDGER_ENTRY_TRACE_KIND,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
  cashTraceRef,
  ledgerEntryTraceRef,
} from './traces';
export { FINANCE_TUNABLE_CATEGORY, financeTunables } from './tunables';
// Reach and size (ECO1-02).
export {
  ALL_REACH_WEIGHTS_ZERO_NOTE,
  promotionReach,
  REACH_MAX,
  REACH_MIN,
  type PromotionReachInputs,
} from './formulas/promotionReach';
export {
  PROMOTION_SIZE_LABELS,
  PROMOTION_SIZES,
  promotionSize,
  SIZE_THRESHOLD_KEYS,
  sizeThresholds,
  THRESHOLD_SIZES,
  THRESHOLDS_OUT_OF_ORDER_NOTE,
  type PromotionSize,
  type ThresholdSize,
} from './formulas/promotionSize';
export { reachOf, type PromotionReach } from './reach';
export {
  companyQuery,
  UNKNOWN_PROMOTION,
  type CompanyNextSize,
  type CompanyView,
} from './queries/company';

// ECO1-03: payroll, medical, the cash Why? and the books queries.
export { canSeeBooks, NOT_YOUR_BOOKS } from './access';
export { cashTrace, recordCashTrace, type CashTraceOptions } from './cashTrace';
export {
  AVERAGE_DAYS_PER_YEAR,
  dailyWageAccrual,
  MONTHS_PER_YEAR,
} from './formulas/dailyWageAccrual';
export {
  MEDICAL_LEVEL_LABELS,
  monthlyMedical,
  type MedicalLevel,
  type MonthlyMedicalInputs,
} from './formulas/monthlyMedical';
export {
  monthlyPayroll,
  PAYROLL_TRACE_LINES_MAX,
  type MonthlyPayrollInputs,
} from './formulas/monthlyPayroll';
export { firstOfMonthLabel, type MonthBreakdown, type MonthTotals } from './months';
export { medicalHeadcount, payrollLinesOf, type PayrollLine, type PayrollReason } from './payroll';
export {
  MONTHLY_MEDICAL_PHASE_ID,
  monthlyMedicalPhase,
  PAYROLL_PHASE_ID,
  payrollFiguresOf,
  payrollPhase,
  type PayrollFigures,
} from './phases';
export {
  DEFAULT_LEDGER_LIMIT,
  DEFAULT_MONTHLY_MONTHS,
  MAX_LEDGER_LIMIT,
  MAX_MONTHLY_MONTHS,
  MONTH_END_CASH_MONTHS,
  type FinanceLedgerArgs,
  type FinanceLedgerPage,
  type FinanceLedgerRow,
  type FinanceMonth,
  type FinanceMonthly,
  type FinanceMonthlyArgs,
  type FinanceOverview,
} from './queries/books';
export { FINANCE_OPENING_BALANCE_STEP } from './setup';

export const financeSystem: SystemBundle = defineSystem({
  id: 'finance',
  phases: [...financePhases],
  subscriptions: [],
  queries: [companyQuery, ...financeBookQueries],
  commands: [],
});
