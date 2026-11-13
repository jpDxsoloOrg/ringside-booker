/**
 * The Why? behind the top bar's cash: "Cash on 1 January + this month's income and costs by
 * category = cash now".
 *
 * `postMoney` rewrites it after every row it posts for a human-controlled promotion, and the
 * `finance.openingBalance` setup step writes it once for each of them at the start of a new game,
 * so the top bar has a Why? from day one. Rivals never get one: nobody can open it. See
 * docs/design/finances.md#queries.
 */

import { yearMonthOf } from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import { LEDGER_CATEGORIES } from '../../model/entities/ledger-entry';
import type { GameWorldView } from '../../model/tables';
import { LEDGER_CATEGORY_LABELS } from './categories';
import { firstOfMonthLabel, monthBreakdown, monthRows } from './months';
import { cashTraceRef } from './traces';

export const CASH_TRACE_DOC_REF = 'docs/design/finances.md#queries';

/** Options for {@link cashTrace}. */
export interface CashTraceOptions {
  /** True at the start of a new game: the starting cash reads "Opening balance". */
  readonly opening?: boolean;
}

/**
 * Explains a promotion's cash on `date`: the cash on the 1st of the month (cash now less this
 * month's rows), then one line per category with a non-zero total this month, in ledger category
 * order. The result's value is the promotion's cash.
 */
export function cashTrace(
  read: GameWorldView,
  promotionId: PromotionId,
  date: StepContext['date'],
  options: CashTraceOptions = {},
): Traced<number> {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  const month = yearMonthOf(date);
  const rows = monthRows(read, promotionId, month);
  const breakdown = monthBreakdown(month, rows);
  const startLabel =
    options.opening === true && rows.length === 0
      ? 'Opening balance'
      : `Cash on ${firstOfMonthLabel(month)}`;
  const calc = startCalc('Cash', promotion.cash - breakdown.net, {
    unit: 'money',
    docRef: CASH_TRACE_DOC_REF,
    startLabel,
  });
  for (const category of LEDGER_CATEGORIES) {
    const total = breakdown.byCategory[category];
    if (total === undefined) {
      continue;
    }
    const label = LEDGER_CATEGORY_LABELS[category];
    if (total > 0) {
      calc.add(label, total);
    } else {
      calc.subtract(label, -total);
    }
  }
  return calc.done();
}

/** Records the cash trace of `promotionId` under `cashTraceRef(promotionId)`. */
export function recordCashTrace(
  ctx: Pick<StepContext, 'read' | 'date' | 'recordTrace'>,
  promotionId: PromotionId,
  options: CashTraceOptions = {},
): void {
  ctx.recordTrace(
    cashTraceRef(promotionId),
    ctx.date,
    cashTrace(ctx.read, promotionId, ctx.date, options),
  );
}
