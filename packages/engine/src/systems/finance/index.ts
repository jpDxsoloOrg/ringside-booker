/**
 * The finance system: the economy's spine.
 *
 * During play there is exactly one way a promotion's cash changes: `postMoney` (`post.ts`). It
 * checks the amount, appends a ledger row, moves the cash in the same transaction, records the
 * row's Why? trace and publishes `finance.moneyPosted`, so the ledger always sums to the change in
 * cash. The phases, queries and commands are filled in by ECO1-02..04. See
 * docs/design/finances.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';

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

export const financeSystem: SystemBundle = defineSystem({
  id: 'finance',
  phases: [],
  subscriptions: [],
  queries: [],
  commands: [],
});
