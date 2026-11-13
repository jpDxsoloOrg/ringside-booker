/** Payroll lines for the formula tests, without a world. */
import { cents } from '../../../../src/core/money';
import type { EmploymentRole } from '../../../../src/model/entities/employment';
import type { PayrollLine, PayrollReason } from '../../../../src/systems/finance';
import { testId } from '../../../support';

/** A payroll line with serial `serial`; paid unless a reason says otherwise. */
export function aLine(
  serial: number,
  monthlyWage: number,
  reason: PayrollReason = 'paid',
  role: EmploymentRole = 'wrestler',
): PayrollLine {
  return {
    employmentId: testId('employment', serial),
    personId: testId('person', serial),
    name: `Worker ${String(serial)}`,
    role,
    monthlyWage: cents(monthlyWage),
    paid: reason === 'paid',
    reason,
  };
}
