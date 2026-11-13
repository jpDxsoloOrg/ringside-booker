/**
 * The Why? behind the top bar's cash: "Opening balance + each earlier month's net + this month's
 * income and costs by category = cash now".
 *
 * `postMoney` rewrites it after every row it posts for a human-controlled promotion, and the
 * `finance.openingBalance` setup step writes it once for each of them at the start of a new game,
 * so the top bar has a Why? from day one. It is one stored trace per promotion, rewritten in place,
 * and stays short however long the game runs: months of earlier years fold into one line per year.
 * Rivals never get one: nobody can open it. See docs/design/finances.md#queries.
 */

import { addYearMonths, yearMonthOf, type YearMonth } from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { startCalc, type Calc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import { LEDGER_CATEGORIES } from '../../model/entities/ledger-entry';
import type { GameWorldView } from '../../model/tables';
import { LEDGER_CATEGORY_LABELS } from './categories';
import { monthBreakdown, monthLabel, monthRows } from './months';
import { cashTraceRef } from './traces';

export const CASH_TRACE_DOC_REF = 'docs/design/finances.md#queries';

/** One line of the cash Why? before this month: a whole earlier year, or one month of this year. */
interface EarlierLine {
  readonly label: string;
  readonly net: number;
}

/** Adds `amount` to `calc` as a gain or a loss; a zero amount adds nothing. */
function addSigned(calc: Calc, label: string, amount: number): void {
  if (amount > 0) {
    calc.add(label, amount);
  } else if (amount < 0) {
    calc.subtract(label, -amount);
  }
}

/**
 * The net of every month from `startMonth` up to (not including) `month`: one line per month of
 * `month`'s year, one per earlier year. Each month is read through the ledger's month index.
 */
function earlierLines(
  read: GameWorldView,
  promotionId: PromotionId,
  startMonth: YearMonth,
  month: YearMonth,
): EarlierLine[] {
  const year = month.slice(0, 4);
  const lines: EarlierLine[] = [];
  let yearLine: { label: string; net: number } | undefined;
  for (let current = startMonth; current < month; current = addYearMonths(current, 1)) {
    const net = monthBreakdown(current, monthRows(read, promotionId, current)).net;
    const currentYear = current.slice(0, 4);
    if (currentYear === year) {
      lines.push({ label: monthLabel(current), net });
      continue;
    }
    if (yearLine?.label !== currentYear) {
      yearLine = { label: currentYear, net: 0 };
      lines.push(yearLine);
    }
    yearLine.net += net;
  }
  return lines;
}

/**
 * Explains a promotion's cash on `date`, from the start of the game: the opening balance (cash now
 * less every row since the month the game started), then the net of each earlier month of this
 * year and of each earlier year, then one line per category with a non-zero total this month, in
 * ledger category order. Lines that come to zero are left out. The result's value is the
 * promotion's cash.
 */
export function cashTrace(
  read: GameWorldView,
  promotionId: PromotionId,
  date: StepContext['date'],
): Traced<number> {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  const month = yearMonthOf(date);
  const gameStart = yearMonthOf(read.meta.startDate);
  const startMonth = gameStart < month ? gameStart : month;
  const earlier = earlierLines(read, promotionId, startMonth, month);
  const breakdown = monthBreakdown(month, monthRows(read, promotionId, month));
  const sinceStart = earlier.reduce((sum, line) => sum + line.net, breakdown.net);
  const calc = startCalc('Cash', promotion.cash - sinceStart, {
    unit: 'money',
    docRef: CASH_TRACE_DOC_REF,
    startLabel: 'Opening balance',
  });
  for (const line of earlier) {
    addSigned(calc, line.label, line.net);
  }
  for (const category of LEDGER_CATEGORIES) {
    const total = breakdown.byCategory[category];
    if (total !== undefined) {
      addSigned(calc, LEDGER_CATEGORY_LABELS[category], total);
    }
  }
  return calc.done();
}

/** Records the cash trace of `promotionId` under `cashTraceRef(promotionId)`. */
export function recordCashTrace(
  ctx: Pick<StepContext, 'read' | 'date' | 'recordTrace'>,
  promotionId: PromotionId,
): void {
  ctx.recordTrace(cashTraceRef(promotionId), ctx.date, cashTrace(ctx.read, promotionId, ctx.date));
}
