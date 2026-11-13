// The ledger reconciles with cash over a long run of payroll and medical (ECO1-03).
// Design: docs/design/finances.md#payroll
import { describe, expect, it } from 'vitest';
import { compareDates, parseGameDate } from '../../../src/core/date';
import { runDay } from '../../../src/core/pipeline/runDay';
import type { GameWorld } from '../../../src/model/tables';
import { monthlyPayroll, payrollLinesOf } from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { rosterWorld } from '../../support';
import { financeRuntime, payrollWorld } from './payroll-world';

/** 400 days from 1 June 2027, so the run crosses 29 February 2028. */
const START = '2027-06-01';
const DAYS = 400;

function cashByPromotion(world: GameWorld): Map<string, number> {
  return new Map(world.tables.promotions.values().map((row) => [row.id, row.cash]));
}

function runFor(world: GameWorld, days: number): void {
  const runtime = financeRuntime(world);
  for (let day = 0; day < days; day += 1) {
    const report = runDay(runtime);
    expect(report.failedCount).toBe(0);
  }
}

function expectReconciles(world: GameWorld, before: Map<string, number>): void {
  for (const promotion of world.tables.promotions.values()) {
    const rows = world.tables.ledgerEntries.lookup('byPromotion', promotion.id);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    expect(promotion.cash - (before.get(promotion.id) ?? 0), promotion.id).toBe(total);
  }
}

describe('payroll and medical over 400 days', () => {
  it("moves every promotion's cash by exactly the sum of its ledger rows (roster world)", () => {
    const { world } = rosterWorld(40, { startDate: START });
    const before = cashByPromotion(world);
    runFor(world, DAYS);
    expect(compareDates(world.meta.currentDate, parseGameDate('2028-03-01'))).toBe(1);
    expectReconciles(world, before);
    expect(world.tables.ledgerEntries.size).toBeGreaterThan(DAYS);
  });

  it('reconciles for human, rival, per-appearance and closed promotions alike', () => {
    const built = payrollWorld(START);
    const before = cashByPromotion(built.world);
    runFor(built.world, DAYS);
    expectReconciles(built.world, before);
  });

  it('pays a year of wages within 365 cents of twelve months of payroll', () => {
    const { world } = rosterWorld(40, { startDate: '2027-03-01' });
    const promotion = world.tables.promotions.values()[0];
    if (promotion === undefined) throw new Error('no promotion');
    const monthly = monthlyPayroll(
      { lines: payrollLinesOf(world, promotion, world.meta.currentDate, createEngineTunables()) },
      { tunables: createEngineTunables() },
    ).value;
    // 1 March 2027 to 29 February 2028, leap day included. A year is 365.25 days on average, so
    // the average day's wages times 365.25 is a year of wages.
    runFor(world, 366);
    const wages = world.tables.ledgerEntries
      .lookup('byPromotion', promotion.id)
      .filter((row) => row.category === 'wages')
      .reduce((sum, row) => sum - row.amount, 0);
    const daily = wages / 366;
    expect(Math.abs(daily * 365.25 - 12 * monthly)).toBeLessThanOrEqual(365);
  });
});
