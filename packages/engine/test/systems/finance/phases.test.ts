// Daily payroll and monthly medical (ECO1-03). Design: docs/design/finances.md#payroll
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { runDay } from '../../../src/core/pipeline/runDay';
import { idStreamName } from '../../../src/core/rng';
import { isFullTrace } from '../../../src/core/trace/store';
import { walkTrace } from '../../../src/core/trace';
import type { LedgerEntry } from '../../../src/model/entities/ledger-entry';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  LEDGER_ENTRY_TRACE_KIND,
  payrollLinesOf,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
} from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { DEFAULT_DAILY_WAGE, financeRuntime, payrollWorld } from './payroll-world';

function rowsOf(world: GameWorld, promotionId: PromotionId, category?: string): LedgerEntry[] {
  return world.tables.ledgerEntries
    .lookup('byPromotion', promotionId)
    .filter((row) => category === undefined || row.category === category);
}

describe('finance phases', () => {
  it('are registered in the money group: payroll daily at 10, medical on the 1st at 20', () => {
    const phases = defaultSystems.flatMap((system) => system.phases);
    expect(phases.find((phase) => phase.id === 'finance.payroll')).toMatchObject({
      group: 'money',
      order: 10,
      cadence: { kind: 'daily' },
    });
    expect(phases.find((phase) => phase.id === 'finance.monthlyMedical')).toMatchObject({
      group: 'money',
      order: 20,
      cadence: { kind: 'monthly', day: 1 },
    });
  });

  it('posts exactly one Wages row per promotion with a monthly wage to pay', () => {
    const built = payrollWorld();
    const runtime = financeRuntime(built.world);
    const today = built.world.meta.currentDate;
    const report = runDay(runtime);
    expect(report.steps.every((step) => step.status !== 'failed')).toBe(true);

    const human = rowsOf(built.world, built.human, 'wages');
    expect(human).toHaveLength(1);
    // Only roster index 0 is paid: the booker, the person on unpaid leave, the pending offer and
    // the contract starting tomorrow are not.
    expect(human[0]).toMatchObject({ date: today, amount: -DEFAULT_DAILY_WAGE, memo: 'Wages' });
    expect(rowsOf(built.world, built.rival, 'wages')).toEqual([
      expect.objectContaining({ amount: -2 * DEFAULT_DAILY_WAGE }),
    ]);
    // Per-appearance deals have no wage, and a closed promotion pays nobody.
    expect(rowsOf(built.world, built.perAppearance)).toEqual([]);
    expect(rowsOf(built.world, built.closed)).toEqual([]);
  });

  it("gives every row a Why? that ends at the row's amount, under the right trace kind", () => {
    const built = payrollWorld();
    const runtime = financeRuntime(built.world);
    runDay(runtime);
    const [human] = rowsOf(built.world, built.human, 'wages');
    const [rival] = rowsOf(built.world, built.rival, 'wages');
    expect(human?.traceRef?.kind).toBe(LEDGER_ENTRY_TRACE_KIND);
    expect(rival?.traceRef?.kind).toBe(RIVAL_LEDGER_ENTRY_TRACE_KIND);
    // A rival's row keeps only a summary of its Why? (POL4-06).
    const rivalStored = runtime.traces.get(rival?.traceRef ?? { kind: 'x', id: 'x' });
    if (rivalStored === undefined || isFullTrace(rivalStored)) {
      throw new Error("expected only a summary of the rival's row");
    }
    expect(rivalStored.summaryOnly).toBe(true);
    expect(rivalStored.value).toBe(rival?.amount);
    for (const row of [human]) {
      const stored =
        row?.traceRef === null
          ? undefined
          : runtime.traces.get(row?.traceRef ?? { kind: 'x', id: 'x' });
      if (stored === undefined || !isFullTrace(stored)) {
        throw new Error('expected a full trace');
      }
      expect(stored.trace.value).toBe(row?.amount);
      const labels: string[] = [];
      walkTrace(stored.trace, (node) => {
        labels.push(node.label);
      });
      expect(labels).toContain('Cost');
      expect(labels).toContain('Monthly payroll');
      expect(labels).toContain('Average days in a year');
    }
  });

  it('marks each active contract paid, or says why not', () => {
    const built = payrollWorld();
    const promotion = built.world.tables.promotions.require(built.human);
    const tunables = createEngineTunables();
    const today = built.world.meta.currentDate;
    const lines = payrollLinesOf(built.world, promotion, today, tunables);
    expect(lines.map((line) => line.reason)).toEqual(['paid', 'ownerOrBooker', 'unpaidLeave']);
    // Before the contracts started, none of them is paid.
    expect(
      payrollLinesOf(built.world, promotion, addDays(today, -1), tunables).map(
        (line) => line.reason,
      ),
    ).toEqual(['notStarted', 'notStarted', 'notStarted']);
    // With the flag on, the booker is paid too.
    const withFlag = createEngineTunables({ 'finance.payOwnerAndBooker': true });
    expect(
      payrollLinesOf(built.world, promotion, today, withFlag).map((line) => line.paid),
    ).toEqual([true, true, false]);
  });

  it('leaves out the owner and booker by person, not only by role', () => {
    const built = payrollWorld();
    const promotion = built.world.tables.promotions.require(built.rival);
    const [first] = built.world.tables.employments.lookup('byPromotion', built.rival);
    const owned = { ...promotion, ownerPersonId: first?.personId ?? null };
    const lines = payrollLinesOf(
      built.world,
      owned,
      built.world.meta.currentDate,
      createEngineTunables(),
    );
    expect(lines.map((line) => line.reason)).toEqual(['ownerOrBooker', 'paid']);
  });

  it('pays nobody when the multiplier is 0, posting no rows', () => {
    const built = payrollWorld();
    const report = runDay(financeRuntime(built.world, { 'finance.wages.multiplier': 0 }));
    expect(built.world.tables.ledgerEntries.size).toBe(0);
    const payroll = report.steps.find((step) => step.stepId === 'finance.payroll');
    expect(payroll?.logs.some((line) => line.includes('Wages comes to 0'))).toBe(true);
  });

  it('posts Medical only on the 1st, and nothing at medical level 0', () => {
    const built = payrollWorld('2026-01-30');
    const runtime = financeRuntime(built.world);
    runDay(runtime); // 30 January
    runDay(runtime); // 31 January
    expect(rowsOf(built.world, built.human, 'medical')).toEqual([]);
    runDay(runtime); // 1 February
    runDay(runtime); // 2 February
    // Medical covers the three active contracts that have started (the booker and the person on
    // leave included), at 15,000 a head for level 1.
    expect(rowsOf(built.world, built.human, 'medical')).toEqual([
      expect.objectContaining({ date: '2026-02-01', amount: -45_000, memo: 'Medical (Basic)' }),
    ]);
    expect(rowsOf(built.world, built.rival, 'medical')).toEqual([]);
    expect(rowsOf(built.world, built.perAppearance, 'medical')).toEqual([
      expect.objectContaining({ amount: -30_000 }),
    ]);
    expect(rowsOf(built.world, built.closed)).toEqual([]);
  });

  it('draws no random numbers beyond the ids of the rows it writes', () => {
    const built = payrollWorld();
    const runtime = financeRuntime(built.world);
    runDay(runtime);
    const touched = Object.keys(runtime.rng.toState().streams);
    expect(touched).toEqual([idStreamName('ledgerEntry')]);
  });
});
