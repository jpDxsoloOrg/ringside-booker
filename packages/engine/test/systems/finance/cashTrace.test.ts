// The cash Why? from the opening balance to the cash now (ECO1-03, ECO1-08).
// Design: docs/design/finances.md#queries
import { describe, expect, it } from 'vitest';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { TraceNode } from '../../../src/core/trace/types';
import type { LedgerCategory } from '../../../src/model/entities/ledger-entry';
import type { GameWorld } from '../../../src/model/tables';
import { cashTrace } from '../../../src/systems/finance';
import { aLedgerEntry, TEST_PLAYER_ID, worldBuilder } from '../../support';

const OPENING = 40_000_000_00;

interface Row {
  readonly date: string;
  readonly category: LedgerCategory;
  readonly amount: number;
}

/** A human promotion that started on `startDate` with the opening cash, plus `rows` posted since. */
function cashWorld(startDate: string, rows: readonly Row[]): { world: GameWorld; id: PromotionId } {
  const net = rows.reduce((sum, row) => sum + row.amount, 0);
  const { world, ids } = worldBuilder({ startDate })
    .withGeography('mini')
    .withPromotion({
      controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      cash: cents(OPENING + net),
    })
    .with('rows', (context) => {
      const promotionId = context.ids.promotions.A;
      if (promotionId === undefined) throw new Error('setup');
      for (const row of rows) {
        context.insert(
          'ledgerEntries',
          aLedgerEntry(
            {
              promotionId,
              date: parseGameDate(row.date),
              category: row.category,
              amount: cents(row.amount),
            },
            context.sequence,
          ),
        );
      }
    })
    .build();
  const id = ids.promotions.A;
  if (id === undefined) throw new Error('setup');
  return { world, id };
}

/** The formula's steps as `[label, signed amount]`, the start first. */
function lines(trace: TraceNode): [string, number][] {
  return (trace.children ?? []).map((child) => {
    if (child.kind === 'add') return [child.label, child.operand];
    if (child.kind === 'subtract') return [child.label, -child.operand];
    return [child.label, typeof child.value === 'number' ? child.value : Number.NaN];
  });
}

/** The start plus every step: what the Why? adds up to. */
function sumOf(trace: TraceNode): number {
  return lines(trace).reduce((sum, [, amount]) => sum + amount, 0);
}

function traceOn(world: GameWorld, id: PromotionId, date: string) {
  return cashTrace(world, id, parseGameDate(date) satisfies GameDate);
}

describe('cashTrace', () => {
  it('is only the opening balance before any money has moved', () => {
    const { world, id } = cashWorld('2027-01-01', []);
    const traced = traceOn(world, id, '2027-01-01');
    expect(traced.value).toBe(OPENING);
    expect(lines(traced.trace)).toEqual([['Opening balance', OPENING]]);
    expect(traced.trace.children?.[0]?.unit).toBe('money');
  });

  it('reads opening balance, each earlier month, then this month by category, ending at the cash', () => {
    const { world, id } = cashWorld('2027-01-01', [
      { date: '2027-01-05', category: 'tickets', amount: 500_000 },
      { date: '2027-01-06', category: 'wages', amount: -800_000 },
      { date: '2027-02-03', category: 'tickets', amount: 900_000 },
      { date: '2027-03-02', category: 'wages', amount: -100_000 },
      { date: '2027-03-04', category: 'tickets', amount: 250_000 },
      { date: '2027-03-05', category: 'wages', amount: -50_000 },
    ]);
    const traced = traceOn(world, id, '2027-03-10');
    const promotion = world.tables.promotions.get(id);
    expect(traced.value).toBe(promotion?.cash);
    expect(lines(traced.trace)).toEqual([
      ['Opening balance', OPENING],
      ['January 2027', -300_000],
      ['February 2027', 900_000],
      ['Tickets', 250_000],
      ['Wages', -150_000],
    ]);
    expect(sumOf(traced.trace)).toBe(traced.value);
  });

  it('leaves out an earlier month that came to nothing', () => {
    const { world, id } = cashWorld('2027-01-20', [
      { date: '2027-03-04', category: 'tickets', amount: 250_000 },
    ]);
    const traced = traceOn(world, id, '2027-03-10');
    expect(lines(traced.trace).map(([label]) => label)).toEqual(['Opening balance', 'Tickets']);
  });

  it('folds the months of earlier years into one line per year, so it stays short', () => {
    const rows: Row[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, '0');
      rows.push({ date: `2027-${mm}-15`, category: 'wages', amount: -10_000 });
      rows.push({ date: `2028-${mm}-15`, category: 'wages', amount: -20_000 });
    }
    rows.push({ date: '2029-01-15', category: 'wages', amount: -30_000 });
    rows.push({ date: '2029-02-02', category: 'tickets', amount: 70_000 });
    const { world, id } = cashWorld('2027-01-01', rows);
    const traced = traceOn(world, id, '2029-02-10');
    expect(lines(traced.trace)).toEqual([
      ['Opening balance', OPENING],
      ['2027', -120_000],
      ['2028', -240_000],
      ['January 2029', -30_000],
      ['Tickets', 70_000],
    ]);
    expect(traced.value).toBe(world.tables.promotions.get(id)?.cash);
  });
});
