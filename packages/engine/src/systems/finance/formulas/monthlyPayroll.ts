/**
 * Monthly payroll: what a promotion's paid contracts cost a month.
 *
 * Design: docs/design/finances.md#payroll. One input per paid contract, summed, then multiplied by
 * `finance.wages.multiplier` when it is not 1 (or has been changed). Every group of contracts that
 * is left out gets a note with its count, and the owner and booker rule is always stated, so the
 * reader sees it even when nobody is affected.
 */

import { startCalc, type Calc } from '../../../core/trace/calc';
import { inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import type { PayrollLine, PayrollReason } from '../payroll';

export const MONTHLY_PAYROLL_DOC_REF = 'docs/design/finances.md#payroll';

/** Paid contracts listed one by one; the rest fold into one line so the trace stays small. */
export const PAYROLL_TRACE_LINES_MAX = 60;

export interface MonthlyPayrollInputs {
  lines: readonly PayrollLine[];
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function countOf(lines: readonly PayrollLine[], reason: PayrollReason): number {
  return lines.filter((line) => line.reason === reason).length;
}

function lineLabel(line: PayrollLine): string {
  return `${line.name} (${line.role})`;
}

/**
 * The first paid line, as the starting input linked to the person. Later lines are plain add steps
 * without their own input node: a big roster's daily Wages trace stays about half the size, which
 * matters because the player's last 200 rows keep their full trace in the save.
 */
function lineInput(line: PayrollLine): Traced<number> {
  return inputOf(
    lineLabel(line),
    line.monthlyWage,
    { kind: 'person', id: line.personId },
    'money/month',
  );
}

/** The notes for every group of contracts that is not paid. */
function addExclusionNotes(
  calc: Calc,
  lines: readonly PayrollLine[],
  tunables: EngineTunables,
): void {
  const notStarted = countOf(lines, 'notStarted');
  if (notStarted > 0) {
    calc.note(`${plural(notStarted, 'contract', 'contracts')} not started yet`);
  }
  const unpaidLeave = countOf(lines, 'unpaidLeave');
  if (unpaidLeave > 0) {
    calc.note(`${plural(unpaidLeave, 'person', 'people')} on unpaid leave`);
  }
  const noWage = countOf(lines, 'noWage');
  if (noWage > 0) {
    calc.note(
      `${plural(noWage, 'deal has', 'deals have')} no monthly wage: paid per appearance instead`,
    );
  }
  // Recorded as a tunable read, so the reader sees the setting and whether it was changed.
  const payOwnerAndBooker = calc.tunable(
    tunables,
    'finance.payOwnerAndBooker',
    "Pay the owner's and booker's contracts a wage",
  );
  if (payOwnerAndBooker) {
    calc.note('Owner and booker are paid a wage too: finance.payOwnerAndBooker is on');
  } else {
    const ownerOrBooker = countOf(lines, 'ownerOrBooker');
    const leftOut =
      ownerOrBooker > 0 ? ` (${plural(ownerOrBooker, 'contract', 'contracts')} left out)` : '';
    calc.note(`Owner and booker are not paid a wage: finance.payOwnerAndBooker is off${leftOut}`);
  }
}

/**
 * The monthly cost of a promotion's paid contracts, in cents (unit `money/month`). The result is a
 * whole number of cents: a multiplier other than 1 is followed by rounding to the nearest cent.
 */
export function monthlyPayroll(
  inputs: MonthlyPayrollInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const paid = inputs.lines.filter((line) => line.paid);
  const [first, ...rest] = paid;
  const calc =
    first === undefined
      ? startCalc('Monthly payroll', 0, {
          unit: 'money/month',
          docRef: MONTHLY_PAYROLL_DOC_REF,
          startLabel: 'No contracts paid a monthly wage',
        })
      : startCalc('Monthly payroll', lineInput(first), {
          unit: 'money/month',
          docRef: MONTHLY_PAYROLL_DOC_REF,
        });

  const listed = rest.slice(0, PAYROLL_TRACE_LINES_MAX - 1);
  for (const line of listed) {
    calc.add(lineLabel(line), line.monthlyWage);
  }
  const folded = rest.slice(PAYROLL_TRACE_LINES_MAX - 1);
  if (folded.length > 0) {
    const total = folded.reduce((sum, line) => sum + line.monthlyWage, 0);
    calc.add(`and ${plural(folded.length, 'more contract', 'more contracts')}`, total);
  }

  addExclusionNotes(calc, inputs.lines, deps.tunables);

  const multiplierKey = 'finance.wages.multiplier';
  if (deps.tunables.get(multiplierKey) !== 1 || deps.tunables.isOverridden(multiplierKey)) {
    calc.multiply('Wage multiplier', calc.tunable(deps.tunables, multiplierKey, 'Wage multiplier'));
    calc.round('round', 'Rounded to the nearest cent');
  }
  return calc.done();
}
