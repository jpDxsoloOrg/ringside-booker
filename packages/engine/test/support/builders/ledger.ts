/**
 * Builder for ledger entries.
 *
 * Default entry: 1,000 of ticket income for `pro_0000000001` on `TEST_START_DATE`, with no memo
 * no references and no trace ref. Give a cost category without an amount and the default amount is -1,000, so
 * the sign always matches the category.
 */

import { cents } from '../../../src/core/money';
import {
  LEDGER_CATEGORY_SIGN,
  LedgerEntrySchema,
  type LedgerEntry,
} from '../../../src/model/entities/ledger-entry';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, TEST_START_DATE, type DeepPartial } from './build-row';

/** The size of the default amount, in cents. */
export const DEFAULT_LEDGER_AMOUNT = 100_000;

export function aLedgerEntry(
  overrides: DeepPartial<LedgerEntry> = {},
  sequence: TestIdSequence = TestIds,
): LedgerEntry {
  const category = overrides.category ?? 'tickets';
  const defaults: LedgerEntry = {
    id: overrides.id ?? sequence.id('ledgerEntry'),
    promotionId: testId('promotion'),
    date: TEST_START_DATE,
    category,
    amount: cents(LEDGER_CATEGORY_SIGN[category] * DEFAULT_LEDGER_AMOUNT),
    memo: null,
    refs: { eventInstanceId: null, personId: null, dealId: null },
    traceRef: null,
  };
  return buildRow(LedgerEntrySchema, 'aLedgerEntry', defaults, overrides);
}
