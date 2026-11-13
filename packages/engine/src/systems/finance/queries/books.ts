/**
 * The books: the three read queries the Finances screen is built on.
 *
 * - `finance.overview`: cash and its Why?, this month and last, the payroll as the next Wages row
 *   will post it, the last twelve month-end balances and the spending policies.
 * - `finance.monthly`: income and costs by category for the last months, with closing cash.
 * - `finance.ledger`: the ledger rows themselves, newest first, filtered and paged.
 *
 * Each one refuses a viewer who may not read the promotion's books (`canSeeBooks`) with
 * `notYourBooks`, and an unknown promotion with `notFound`. Results are plain JSON. See
 * docs/design/finances.md#queries.
 */

import { z } from 'zod';
import { refuseQuery } from '../../../core/api/result';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../../core/api/query';
import {
  addYearMonths,
  compareDates,
  yearMonthOf,
  type GameDate,
  type YearMonth,
} from '../../../core/date';
import type { EventInstanceId, LedgerEntryId, PromotionId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { TraceNode } from '../../../core/trace/types';
import {
  LEDGER_CATEGORIES,
  LedgerCategorySchema,
  type LedgerCategory,
  type LedgerEntry,
  type LedgerRefs,
} from '../../../model/entities/ledger-entry';
import type { Promotion } from '../../../model/entities/promotion';
import { zId, zYearMonth } from '../../../model/primitives';
import { canSeeBooks } from '../access';
import { LEDGER_CATEGORY_LABELS, ledgerCategoryKind, type LedgerCategoryKind } from '../categories';
import {
  monthBreakdownOf,
  monthRows,
  monthTotalsOf,
  type MonthBreakdown,
  type MonthTotals,
} from '../months';
import { payrollFiguresOf } from '../phases';
import { currentCashTraceRef } from '../../../core/api/builtins';
import type { DeepReadonly } from '../../../model/world';
import { detailKeptNote } from '../../history/note';

export type { MonthTotals } from '../months';

/** `finance.overview`: a promotion's money at a glance. */
export interface FinanceOverview {
  promotionId: PromotionId;
  date: GameDate;
  cash: number;
  /** The stored Why? of the cash, or null when none is stored (rivals never have one). */
  cashTraceRef: TraceRef | null;
  thisMonth: MonthTotals;
  /** Null when last month is before the game started. */
  lastMonth: MonthTotals | null;
  /** What the paid contracts cost a month, in cents. */
  monthlyPayroll: number;
  monthlyPayrollTrace: TraceNode;
  /** Today's wages: what the next Wages row will post, as a positive number of cents. */
  dailyWages: number;
  dailyWagesTrace: TraceNode;
  /** How many contracts are paid a monthly wage. */
  paidContracts: number;
  /**
   * Cash at the end of each of the last twelve months, oldest first. The last entry is the current
   * month so far, so its cash is the cash now; earlier ones are worked back through each month's
   * net.
   */
  monthEndCash: { month: YearMonth; cash: number }[];
  policies: Promotion['policies'];
}

/** One month of `finance.monthly`. */
export interface FinanceMonth extends MonthBreakdown {
  /** Cash at the end of the month (for the current month: the cash now). */
  closingCash: number;
}

/** `finance.monthly`: the last months by category. */
export interface FinanceMonthly {
  /** Oldest first; months with no rows are included as zeros. */
  months: FinanceMonth[];
  /** The categories with a non-zero total in any listed month, in ledger category order. */
  categories: LedgerCategory[];
  /** The month the game started in: earlier months are before anything happened. */
  startMonth: YearMonth;
}

/** One row of `finance.ledger`. */
export interface FinanceLedgerRow {
  id: LedgerEntryId;
  date: GameDate;
  category: LedgerCategory;
  /** The category's player-facing name. */
  label: string;
  kind: LedgerCategoryKind;
  /** Signed cents: income positive, costs negative. */
  amount: number;
  memo: string | null;
  refs: LedgerRefs;
  /**
   * The row's stored Why?, or null when it is no longer kept in full (older rows' traces are
   * summarised: the full breakdown is only kept for recent results).
   */
  traceRef: TraceRef | null;
}

/** `finance.ledger`: a page of rows, newest first. */
export interface FinanceLedgerPage {
  rows: FinanceLedgerRow[];
  /** Pass as `before` for the next page; null when this page is the last. */
  nextCursor: LedgerEntryId | null;
  /**
   * Set once older rows have been rolled up into monthly totals (POL4-08): rows dated on or before
   * `through` are no longer listed one by one, only in the month totals. `note` says so in plain
   * words. Null while every row is still kept.
   */
  rolledUp: { through: GameDate; note: string } | null;
}

/** The last day whose rows were rolled up for the promotion, or null when none were. */
function rolledUpThrough(promotion: DeepReadonly<Promotion>): GameDate | null {
  let through: GameDate | null = null;
  for (const month of promotion.ledgerMonths) {
    if (through === null || compareDates(month.through, through) > 0) {
      through = month.through;
    }
  }
  return through;
}

export interface FinanceMonthlyArgs {
  promotionId: PromotionId;
  months?: number;
}

export interface FinanceLedgerArgs {
  promotionId: PromotionId;
  month?: YearMonth;
  category?: LedgerCategory;
  eventInstanceId?: EventInstanceId;
  limit?: number;
  before?: LedgerEntryId;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'finance.overview': { args: { promotionId: PromotionId }; result: FinanceOverview };
    'finance.monthly': { args: FinanceMonthlyArgs; result: FinanceMonthly };
    'finance.ledger': { args: FinanceLedgerArgs; result: FinanceLedgerPage };
  }
}

/** Months `finance.monthly` lists when not told: a year. */
export const DEFAULT_MONTHLY_MONTHS = 12;
/** The most months `finance.monthly` lists. */
export const MAX_MONTHLY_MONTHS = 24;
/** Month-end balances in `finance.overview`. */
export const MONTH_END_CASH_MONTHS = 12;
/** Rows `finance.ledger` returns when not told. */
export const DEFAULT_LEDGER_LIMIT = 100;
/** The most rows one `finance.ledger` page holds. */
export const MAX_LEDGER_LIMIT = 500;

/** The promotion, once the viewer is allowed to read its books. Refuses the query otherwise. */
export function booksOf(ctx: QueryContext, promotionId: PromotionId): Promotion {
  const promotion = ctx.read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    return refuseQuery({ code: 'notFound', message: 'No such promotion', field: 'promotionId' });
  }
  const denied = canSeeBooks(ctx.read, ctx.viewer, promotionId);
  if (denied.length > 0) {
    return refuseQuery(denied);
  }
  return promotion;
}

/**
 * The last `count` months up to the current one, oldest first, each with its breakdown and its
 * closing cash, worked back from the cash now.
 */
function recentMonths(ctx: QueryContext, promotion: Promotion, count: number): FinanceMonth[] {
  const current = yearMonthOf(ctx.date);
  const months: FinanceMonth[] = [];
  let closingCash: number = promotion.cash;
  for (let back = 0; back < count; back += 1) {
    const month = addYearMonths(current, -back);
    const breakdown = monthBreakdownOf(ctx.read, promotion.id, month);
    months.push({ ...breakdown, closingCash });
    closingCash -= breakdown.net;
  }
  return months.reverse();
}

function storedRef(ctx: QueryContext, ref: TraceRef | null): TraceRef | null {
  return ref !== null && ctx.traces.has(ref) ? ref : null;
}

export const financeOverviewQuery: QueryDefinition<'finance.overview'> = defineQuery(
  'finance.overview',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      const promotion = booksOf(ctx, args.promotionId);
      const months = recentMonths(ctx, promotion, MONTH_END_CASH_MONTHS);
      const thisMonth = months.at(-1);
      const previous = months.at(-2);
      if (thisMonth === undefined || previous === undefined) {
        throw new Error('finance.overview: the month list is shorter than two months');
      }
      const startMonth = yearMonthOf(ctx.read.meta.startDate);
      const payroll = payrollFiguresOf(ctx.read, promotion, ctx.date, ctx.tunables);
      return {
        promotionId: promotion.id,
        date: ctx.date,
        cash: promotion.cash,
        cashTraceRef: currentCashTraceRef(ctx.traces, promotion),
        thisMonth: monthTotalsOf(thisMonth),
        lastMonth: previous.month < startMonth ? null : monthTotalsOf(previous),
        monthlyPayroll: payroll.monthly.value,
        monthlyPayrollTrace: payroll.monthly.trace,
        dailyWages: payroll.daily.value,
        dailyWagesTrace: payroll.daily.trace,
        paidContracts: payroll.lines.filter((line) => line.paid).length,
        monthEndCash: months.map((month) => ({ month: month.month, cash: month.closingCash })),
        policies: { ...promotion.policies },
      };
    },
  },
);

export const financeMonthlyQuery: QueryDefinition<'finance.monthly'> = defineQuery(
  'finance.monthly',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      months: z.number().int().min(1).max(MAX_MONTHLY_MONTHS).exactOptional(),
    }),
    run: (ctx, args) => {
      const promotion = booksOf(ctx, args.promotionId);
      const months = recentMonths(ctx, promotion, args.months ?? DEFAULT_MONTHLY_MONTHS);
      const categories = LEDGER_CATEGORIES.filter((category) =>
        months.some((month) => month.byCategory[category] !== undefined),
      );
      return { months, categories, startMonth: yearMonthOf(ctx.read.meta.startDate) };
    },
  },
);

function rolledUpOf(ctx: QueryContext, promotion: Promotion): FinanceLedgerPage['rolledUp'] {
  const through = rolledUpThrough(promotion);
  return through === null
    ? null
    : {
        through,
        note: `${detailKeptNote(ctx.tunables)} Older money is shown as monthly totals.`,
      };
}

/** Newest first: later date first, then the larger id. */
function newestFirst(left: LedgerEntry, right: LedgerEntry): number {
  const byDate = compareDates(right.date, left.date);
  if (byDate !== 0) {
    return byDate;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? 1 : -1;
}

export const financeLedgerQuery: QueryDefinition<'finance.ledger'> = defineQuery('finance.ledger', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    month: zYearMonth.exactOptional(),
    category: LedgerCategorySchema.exactOptional(),
    eventInstanceId: zId('eventInstance').exactOptional(),
    limit: z.number().int().min(1).max(MAX_LEDGER_LIMIT).exactOptional(),
    before: zId('ledgerEntry').exactOptional(),
  }),
  run: (ctx, args) => {
    const promotion = booksOf(ctx, args.promotionId);
    const { tables } = ctx.read;
    let cursor: LedgerEntry | undefined;
    if (args.before !== undefined) {
      cursor = tables.ledgerEntries.get(args.before);
      if (cursor?.promotionId !== promotion.id) {
        return refuseQuery({
          code: 'invalidArgs',
          message: "before: not a row of this promotion's ledger",
          field: 'before',
        });
      }
    }
    const source =
      args.month === undefined
        ? tables.ledgerEntries.lookup('byPromotion', promotion.id)
        : monthRows(ctx.read, promotion.id, args.month);
    const matching = source
      .filter(
        (row) =>
          (args.category === undefined || row.category === args.category) &&
          (args.eventInstanceId === undefined ||
            row.refs.eventInstanceId === args.eventInstanceId) &&
          (cursor === undefined || newestFirst(cursor, row) < 0),
      )
      .sort(newestFirst);
    const limit = args.limit ?? DEFAULT_LEDGER_LIMIT;
    const page = matching.slice(0, limit);
    const last = page.at(-1);
    return {
      rows: page.map((row) => ({
        id: row.id,
        date: row.date,
        category: row.category,
        label: LEDGER_CATEGORY_LABELS[row.category],
        kind: ledgerCategoryKind(row.category),
        amount: row.amount,
        memo: row.memo,
        refs: { ...row.refs },
        traceRef: storedRef(ctx, row.traceRef === null ? null : { ...row.traceRef }),
      })),
      nextCursor: matching.length > limit && last !== undefined ? last.id : null,
      rolledUp: rolledUpOf(ctx, promotion),
    };
  },
});

export const financeBookQueries: readonly QueryDefinition[] = [
  financeOverviewQuery,
  financeMonthlyQuery,
  financeLedgerQuery,
];
