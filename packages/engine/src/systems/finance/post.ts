/**
 * `postMoney`: the only way a promotion's cash changes during play.
 *
 * Every money feature (wages, show costs, box office, fines, buyouts) calls it. It appends one
 * ledger row and moves the promotion's cash by the same amount in the caller's transaction, so the
 * sum of a promotion's rows always equals the change in its cash. It also records the row's Why?
 * trace and publishes `finance.moneyPosted` (and, for a human-controlled promotion, rewrites the
 * cash Why?, `cashTrace.ts`). If anything is wrong it throws before writing, and
 * the error rolls the caller's step back. A test (`cash-seam.test.ts`) keeps any other code from
 * writing `promotions.cash`, apart from the opening balances of a new world.
 *
 * Cash may go negative: a cost is never refused for lack of money (financial distress belongs to
 * ECO9). Commands that need a cash check do it in their own `validate`.
 *
 * See docs/design/finances.md#postmoney.
 */

import type { GameDate } from '../../core/date';
import { isAfter } from '../../core/date';
import { EntityNotFoundError, InvalidArgumentError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { add, isCents, type Cents } from '../../core/money';
import type { StepContext } from '../../core/pipeline/context';
import { inputOf } from '../../core/trace/helpers';
import type { Traced } from '../../core/trace/types';
import {
  hasLedgerSign,
  LEDGER_CATEGORY_SIGN,
  type LedgerCategory,
  type LedgerEntry,
  type LedgerRefs,
} from '../../model/entities/ledger-entry';
import { recordCashTrace } from './cashTrace';
import { ledgerEntryTraceRef } from './traces';

/** The longest memo a ledger row can carry, after trimming. */
export const POST_MONEY_MEMO_MAX = 120;

/** What a caller of {@link postMoney} hands it. */
export interface PostMoneyInput {
  readonly promotionId: PromotionId;
  readonly category: LedgerCategory;
  /** Signed cents: positive for an income category, negative for a cost. Never zero. */
  readonly amount: Cents;
  /** The day the money moved. Defaults to the step's date and may not be after it. */
  readonly date?: GameDate;
  /** A short plain-words line for the ledger, 1 to 120 characters after trimming. */
  readonly memo: string;
  /** What the row is about. Missing refs are stored as null. */
  readonly refs?: Partial<LedgerRefs>;
  /**
   * How the amount was worked out, for the row's Why?. Its value must equal `amount`. Without one,
   * the row gets a one-line trace naming the memo.
   */
  readonly trace?: Traced<number>;
}

const FUNCTION_NAME = 'postMoney';

/**
 * Appends a ledger row and moves the promotion's cash by `amount`, in the step's transaction.
 * Returns the new row. Works from phases, subscriptions and commands alike.
 *
 * Throws `InvalidArgumentError` for a zero amount, an amount whose sign the category does not
 * allow, a closed promotion, a date after the step's date, an empty or too long memo, or a trace
 * whose value is not the amount; `EntityNotFoundError` for an unknown promotion.
 */
export function postMoney(ctx: StepContext, input: PostMoneyInput): LedgerEntry {
  const { promotionId, category, amount } = input;

  // (1) The amount: a whole, non-zero number of cents with the category's sign.
  if (!isCents(amount) || !hasLedgerSign(category, amount)) {
    const expected = LEDGER_CATEGORY_SIGN[category] > 0 ? 'positive' : 'negative';
    throw new InvalidArgumentError(
      FUNCTION_NAME,
      'amount',
      amount,
      `a non-zero whole number of cents, ${expected} for the ${category} category`,
    );
  }

  // (2) The promotion: it must exist and still be open.
  const promotion = ctx.read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  if (promotion.status === 'closed') {
    throw new InvalidArgumentError(FUNCTION_NAME, 'promotionId', promotionId, 'an open promotion');
  }

  // (3) The date: today or earlier.
  const date = input.date ?? ctx.date;
  if (isAfter(date, ctx.date)) {
    throw new InvalidArgumentError(FUNCTION_NAME, 'date', date, `on or before ${ctx.date}`);
  }

  // (4) The memo.
  const memo = input.memo.trim();
  if (memo.length === 0 || memo.length > POST_MONEY_MEMO_MAX) {
    throw new InvalidArgumentError(
      FUNCTION_NAME,
      'memo',
      input.memo,
      `1 to ${String(POST_MONEY_MEMO_MAX)} characters after trimming`,
    );
  }

  // A given trace must explain this very number.
  if (input.trace !== undefined && input.trace.value !== amount) {
    throw new InvalidArgumentError(
      FUNCTION_NAME,
      'trace',
      input.trace.value,
      `a trace whose value is the amount posted (${String(amount)})`,
    );
  }

  // (5) The row and the cash, in the same transaction. The ID is minted first because the row's
  // trace ref names it.
  const { tx } = ctx;
  const id = tx.mintId('ledgerEntries');
  const traceRef = ledgerEntryTraceRef({ id }, promotion.controller.kind === 'human');
  const entry = tx.insert('ledgerEntries', {
    id,
    promotionId,
    date,
    category,
    amount,
    memo,
    refs: { eventInstanceId: null, personId: null, dealId: null, ...input.refs },
    traceRef,
  });
  tx.update('promotions', promotionId, (previous) => ({
    ...previous,
    cash: add(previous.cash, amount),
  }));

  // (6) The row's Why?.
  const trace =
    input.trace ?? inputOf(`Amount posted: ${memo}`, amount, { kind: 'ledgerEntry', id }, 'money');
  ctx.recordTrace(traceRef, date, trace);

  // (7) The event and the top bar's cash Why?, for human-controlled promotions only (see
  // docs/design/finances.md#postmoney).
  if (promotion.controller.kind === 'human') {
    recordCashTrace(ctx, promotionId);
    ctx.publish('finance.moneyPosted', {
      promotionId,
      ledgerEntryId: id,
      category,
      amount,
      date,
    });
  }
  return entry;
}
