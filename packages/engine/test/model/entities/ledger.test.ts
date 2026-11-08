import { describe, expect, it } from 'vitest';
import { AppendOnlyError } from '../../../src/core/errors';
import { cents } from '../../../src/core/money';
import {
  LEDGER_CATEGORIES,
  LEDGER_CATEGORY_SIGN,
  LEDGER_COST_CATEGORIES,
  LEDGER_INCOME_CATEGORIES,
  ledgerEntriesTable,
  LedgerEntrySchema,
  ledgerMonthKey,
} from '../../../src/model/entities/ledger-entry';
import { TABLES } from '../../../src/model/tables';
import {
  date,
  emptyGeoMediaWorld,
  makeLedgerEntry,
  testId,
} from '../../support/geo-media-fixtures';

describe('ledger categories', () => {
  it('signs every income category +1 and every cost category -1', () => {
    expect(Object.keys(LEDGER_CATEGORY_SIGN).sort()).toEqual([...LEDGER_CATEGORIES].sort());
    for (const category of LEDGER_INCOME_CATEGORIES) {
      expect(LEDGER_CATEGORY_SIGN[category]).toBe(1);
    }
    for (const category of LEDGER_COST_CATEGORIES) {
      expect(LEDGER_CATEGORY_SIGN[category]).toBe(-1);
    }
    expect(LEDGER_CATEGORIES).toHaveLength(20);
  });
});

describe('ledger entry schema', () => {
  it('accepts income as positive and costs as negative', () => {
    expect(LedgerEntrySchema.safeParse(makeLedgerEntry(1)).success).toBe(true);
    expect(
      LedgerEntrySchema.safeParse(
        makeLedgerEntry(1, { category: 'wages', amount: cents(-80_000), memo: 'Weekly payroll' }),
      ).success,
    ).toBe(true);
  });

  it('rejects wages with a positive amount', () => {
    const result = LedgerEntrySchema.safeParse(
      makeLedgerEntry(1, { category: 'wages', amount: cents(80_000) }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['amount']);
    expect(result.error?.issues[0]?.message).toMatch(/negative/);
  });

  it('rejects tickets with a negative amount', () => {
    const result = LedgerEntrySchema.safeParse(
      makeLedgerEntry(1, { category: 'tickets', amount: cents(-1) }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/positive/);
  });

  it('rejects a zero amount, a fractional amount and a long memo', () => {
    expect(LedgerEntrySchema.safeParse(makeLedgerEntry(1, { amount: cents(0) })).success).toBe(
      false,
    );
    expect(LedgerEntrySchema.safeParse({ ...makeLedgerEntry(1), amount: 10.5 }).success).toBe(
      false,
    );
    expect(LedgerEntrySchema.safeParse(makeLedgerEntry(1, { memo: 'x'.repeat(121) })).success).toBe(
      false,
    );
  });
});

describe('ledger table', () => {
  it('is append-only in the production registry', () => {
    // Transactions refuse update and delete on append-only tables with AppendOnlyError.
    expect(ledgerEntriesTable.appendOnly).toBe(true);
    expect(TABLES.ledgerEntries.appendOnly).toBe(true);
  });

  it('refuses tx.update and tx.delete on a ledger row and leaves the row as it was', () => {
    const world = emptyGeoMediaWorld();
    const entry = makeLedgerEntry(1);
    world.tables.ledgerEntries._put(entry);

    const updated = world.transact('edit-ledger', (tx) => {
      tx.update('ledgerEntries', entry.id, { amount: cents(1) });
    });
    const deleted = world.transact('remove-ledger', (tx) => {
      tx.delete('ledgerEntries', entry.id);
    });

    for (const result of [updated, deleted]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(AppendOnlyError);
      }
    }
    expect(world.tables.ledgerEntries.get(entry.id)).toEqual(entry);
    expect(world.tables.ledgerEntries.size).toBe(1);
  });

  it("byPromotionMonth returns one promotion's entries for 2026-03 only", () => {
    const world = emptyGeoMediaWorld();
    world.tables.ledgerEntries._put(makeLedgerEntry(1, { date: date('2026-02-28') }));
    world.tables.ledgerEntries._put(makeLedgerEntry(2, { date: date('2026-03-01') }));
    world.tables.ledgerEntries._put(makeLedgerEntry(3, { date: date('2026-03-31') }));
    world.tables.ledgerEntries._put(makeLedgerEntry(4, { date: date('2026-04-01') }));
    world.tables.ledgerEntries._put(
      makeLedgerEntry(5, { date: date('2026-03-15'), promotionId: testId('promotion', 2) }),
    );
    world.tables.ledgerEntries._put(makeLedgerEntry(6, { date: date('2025-03-15') }));

    const march = world.tables.ledgerEntries.lookup(
      'byPromotionMonth',
      ledgerMonthKey(testId('promotion', 1), '2026-03'),
    );
    expect(march.map((entry) => entry.id)).toEqual([
      testId('ledgerEntry', 2),
      testId('ledgerEntry', 3),
    ]);
    expect(ledgerMonthKey(testId('promotion', 1), '2026-03')).toBe(
      `${testId('promotion', 1)}|2026-03`,
    );
  });
});
