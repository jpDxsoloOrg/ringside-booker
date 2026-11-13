// Monthly payroll (ECO1-03). Design: docs/design/finances.md#payroll
import { describe, expect, it } from 'vitest';
import { countTraceNodes, TRACE_MAX_NODES } from '../../../../src/core/trace/limits';
import { walkTrace, type TraceNode } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { monthlyPayroll, PAYROLL_TRACE_LINES_MAX } from '../../../../src/systems/finance';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { aLine } from './payroll-lines';

function payroll(
  lines: Parameters<typeof monthlyPayroll>[0]['lines'],
  overrides: TunableOverrides = {},
) {
  return monthlyPayroll({ lines }, { tunables: createEngineTunables(overrides) });
}

function labels(node: TraceNode): string[] {
  const found: string[] = [];
  walkTrace(node, (visited) => {
    found.push(visited.label);
  });
  return found;
}

describe('monthlyPayroll', () => {
  it('is 0 for an empty roster, and still states the owner and booker rule', () => {
    const result = payroll([]);
    expect(result.value).toBe(0);
    expectTraceReplays(result);
    expect(labels(result.trace)).toContain(
      'Owner and booker are not paid a wage: finance.payOwnerAndBooker is off',
    );
  });

  it('is the wage of a single paid contract, named with its role', () => {
    const result = payroll([aLine(1, 500_000)]);
    expect(result.value).toBe(500_000);
    expect(result.trace.unit).toBe('money/month');
    expect(labels(result.trace)).toContain('Worker 1 (wrestler)');
    expectTraceReplays(result);
    expectSerialisable(result.trace);
  });

  it('sums every paid line and leaves out the rest, with a note per excluded group', () => {
    const result = payroll([
      aLine(1, 500_000),
      aLine(2, 300_000, 'paid', 'referee'),
      aLine(3, 400_000, 'notStarted'),
      aLine(4, 400_000, 'notStarted'),
      aLine(5, 250_000, 'unpaidLeave'),
      aLine(6, 0, 'noWage'),
      aLine(7, 900_000, 'ownerOrBooker', 'booker'),
    ]);
    expect(result.value).toBe(800_000);
    expectTraceReplays(result);
    const text = labels(result.trace);
    expect(text).toContain('Worker 2 (referee)');
    expect(text).toContain('2 contracts not started yet');
    expect(text).toContain('1 person on unpaid leave');
    expect(text).toContain('1 deal has no monthly wage: paid per appearance instead');
    expect(text).toContain(
      'Owner and booker are not paid a wage: finance.payOwnerAndBooker is off (1 contract left out)',
    );
    expect(text).not.toContain('Worker 7 (booker)');
  });

  it('says the owner and booker are paid when the flag is on', () => {
    const result = payroll([aLine(1, 500_000)], { 'finance.payOwnerAndBooker': true });
    expect(labels(result.trace)).toContain(
      'Owner and booker are paid a wage too: finance.payOwnerAndBooker is on',
    );
    expectTraceReplays(result);
  });

  it('pays nobody with a multiplier of 0, and shows the multiplier', () => {
    const result = payroll([aLine(1, 500_000), aLine(2, 300_000)], {
      'finance.wages.multiplier': 0,
    });
    expect(result.value).toBe(0);
    expect(labels(result.trace)).toContain('Wage multiplier');
    expectTraceReplays(result);
  });

  it('rounds a multiplied payroll to the cent', () => {
    const result = payroll([aLine(1, 333)], { 'finance.wages.multiplier': 1.05 });
    expect(result.value).toBe(350);
    expect(Number.isInteger(result.value)).toBe(true);
    expectTraceReplays(result);
  });

  it('shows no multiplier step at the default of 1', () => {
    expect(labels(payroll([aLine(1, 500_000)]).trace)).not.toContain('Wage multiplier');
  });

  it(`folds lines beyond ${String(PAYROLL_TRACE_LINES_MAX)} into one, keeping the trace small`, () => {
    const lines = Array.from({ length: 300 }, (_, index) => aLine(index + 1, 100_000 + index));
    const result = payroll(lines);
    const expected = lines.reduce((sum, line) => sum + line.monthlyWage, 0);
    expect(result.value).toBe(expected);
    expect(labels(result.trace)).toContain('and 240 more contracts');
    expect(labels(result.trace)).not.toContain('Worker 61 (wrestler)');
    expect(countTraceNodes(result.trace)).toBeLessThan(TRACE_MAX_NODES);
    expectTraceReplays(result);
  });
});
