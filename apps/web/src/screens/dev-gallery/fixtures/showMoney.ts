import {
  inputOf,
  LEDGER_CATEGORY_LABELS,
  ledgerCategoryKind,
  ledgerEntryTraceRef,
  parseGameDate,
  parseId,
  startCalc,
  yearMonthOf,
} from '@ringside/engine';
import type {
  FinanceLedgerRow,
  LedgerCategory,
  StoredTraceEntry,
  YearMonth,
} from '@ringside/engine';

/**
 * One show's ledger rows as `finance.ledger { eventInstanceId }` might return them, for the
 * gallery's Show money entry and its tests. Gallery data only, all invented; no engine is asked.
 */

export const GALLERY_SHOW_MONEY_NAME = 'Friday Night Fury';

const SHOW_DATE = parseGameDate('2027-03-12');

export const GALLERY_SHOW_MONEY_MONTH: YearMonth = yearMonthOf(SHOW_DATE);

const SHOW_ID = parseId('eventInstance', 'evi_0000000042');

function row(
  index: number,
  category: LedgerCategory,
  amount: number,
  memo: string | null,
  kept: boolean,
): FinanceLedgerRow {
  const id = parseId('ledgerEntry', `led_${String(9000 + index).padStart(10, '0')}`);
  return {
    id,
    date: SHOW_DATE,
    category,
    label: LEDGER_CATEGORY_LABELS[category],
    kind: ledgerCategoryKind(category),
    amount,
    memo,
    refs: { eventInstanceId: SHOW_ID, personId: null, dealId: null },
    traceRef: kept ? ledgerEntryTraceRef({ id }, true) : null,
  };
}

/** A regular show at home: gate, TV money, rent, then the three costs ECO1 posts. Newest first. */
export const galleryShowMoneyRows: readonly FinanceLedgerRow[] = [
  row(6, 'catering', -25_000, `${GALLERY_SHOW_MONEY_NAME}: catering`, true),
  row(5, 'travel', -65_000, `${GALLERY_SHOW_MONEY_NAME}: travel`, true),
  row(4, 'appearanceFees', -40_000, `${GALLERY_SHOW_MONEY_NAME}: appearance fees`, true),
  row(3, 'venueRent', -1_500_000, null, false),
  row(2, 'broadcast', 100_000, null, false),
  row(1, 'tickets', 8_400_000, null, false),
];

/** Small stand-in Why? breakdowns for the rows that keep one, for the gallery's trace transport. */
export function galleryShowMoneyTraces(): StoredTraceEntry[] {
  return galleryShowMoneyRows.flatMap((entry, index) => {
    if (entry.traceRef === null) return [];
    const trace = startCalc('Cost', inputOf(entry.memo ?? entry.label, entry.amount), {
      unit: 'money',
    }).done().trace;
    return [{ ref: entry.traceRef, date: SHOW_DATE, seq: index + 1, trace, value: entry.amount }];
  });
}
