/**
 * Month arithmetic over a promotion's ledger: the rows of one month and their totals.
 *
 * Every read goes through the ledger's `byPromotionMonth` index, so a month costs only its own
 * rows however long the game has run. See docs/design/finances.md#queries.
 */

import type { YearMonth } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import {
  LEDGER_CATEGORIES,
  ledgerMonthKey,
  type LedgerCategory,
  type LedgerEntry,
} from '../../model/entities/ledger-entry';
import type { GameWorldView } from '../../model/tables';

/** A month's money in and out. `costs` is negative (or 0); `net` is `income + costs`. */
export interface MonthTotals {
  month: YearMonth;
  income: number;
  costs: number;
  net: number;
}

/** A month's totals with the amount per category (non-zero categories only). */
export interface MonthBreakdown extends MonthTotals {
  byCategory: Partial<Record<LedgerCategory, number>>;
}

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

/** "January 2027": a month, in words. */
export function monthLabel(month: YearMonth): string {
  const monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  return `${monthName} ${month.slice(0, 4)}`;
}

/** "1 January 2027": the first day of a month, in words. */
export function firstOfMonthLabel(month: YearMonth): string {
  return `1 ${monthLabel(month)}`;
}

/** A promotion's ledger rows dated in `month`, in id order. */
export function monthRows(
  read: GameWorldView,
  promotionId: PromotionId,
  month: YearMonth,
): readonly LedgerEntry[] {
  return read.tables.ledgerEntries.lookup('byPromotionMonth', ledgerMonthKey(promotionId, month));
}

/** The totals of `rows`, which all belong to `month`. */
export function monthBreakdown(month: YearMonth, rows: readonly LedgerEntry[]): MonthBreakdown {
  const sums = new Map<LedgerCategory, number>();
  let income = 0;
  let costs = 0;
  for (const row of rows) {
    sums.set(row.category, (sums.get(row.category) ?? 0) + row.amount);
    if (row.amount > 0) {
      income += row.amount;
    } else {
      costs += row.amount;
    }
  }
  const byCategory: Partial<Record<LedgerCategory, number>> = {};
  for (const category of LEDGER_CATEGORIES) {
    const total = sums.get(category);
    if (total !== undefined && total !== 0) {
      byCategory[category] = total;
    }
  }
  return { month, income, costs, net: income + costs, byCategory };
}

/** Just the totals of a breakdown. */
export function monthTotalsOf(breakdown: MonthBreakdown): MonthTotals {
  return {
    month: breakdown.month,
    income: breakdown.income,
    costs: breakdown.costs,
    net: breakdown.net,
  };
}
