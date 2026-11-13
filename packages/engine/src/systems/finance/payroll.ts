/**
 * Who a promotion pays a wage, and why everyone else is left out.
 *
 * Only `active` contracts are read (through the `byPromotionStatus` index), so offers, signed
 * contracts waiting to start, and contracts that have ended are never paid. Among the active ones a
 * line is left unpaid when the contract has not started yet, the person is on unpaid leave, the
 * person is the owner or the booker (unless `finance.payOwnerAndBooker` is on), or the deal has no
 * monthly wage (per-appearance deals are paid per show). See docs/design/finances.md#payroll.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId } from '../../core/ids';
import type { Cents } from '../../core/money';
import {
  promotionStatusKey,
  type Employment,
  type EmploymentRole,
} from '../../model/entities/employment';
import type { Promotion } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** Why a payroll line is, or is not, paid. */
export type PayrollReason = 'paid' | 'notStarted' | 'unpaidLeave' | 'ownerOrBooker' | 'noWage';

/** One active contract on a promotion's payroll. */
export interface PayrollLine {
  employmentId: EmploymentId;
  personId: PersonId;
  /** The name the person works under at this promotion. */
  name: string;
  role: EmploymentRole;
  /** The contract's monthly wage, before `finance.wages.multiplier`. */
  monthlyWage: Cents;
  paid: boolean;
  reason: PayrollReason;
}

/** True when the contract has started on or before `date`. */
export function hasStarted(employment: Pick<Employment, 'startsOn'>, date: GameDate): boolean {
  return compareDates(employment.startsOn, date) <= 0;
}

/** True when the person is on leave without pay on `date`. */
function onUnpaidLeave(employment: Pick<Employment, 'leave'>, date: GameDate): boolean {
  const { leave } = employment;
  return leave !== null && !leave.paid && compareDates(leave.until, date) >= 0;
}

function isOwnerOrBooker(
  employment: Pick<Employment, 'personId' | 'role'>,
  promotion: Pick<Promotion, 'ownerPersonId' | 'bookerPersonId'>,
): boolean {
  return (
    employment.personId === promotion.ownerPersonId ||
    employment.personId === promotion.bookerPersonId ||
    employment.role === 'booker'
  );
}

function reasonFor(
  employment: Employment,
  promotion: Pick<Promotion, 'ownerPersonId' | 'bookerPersonId'>,
  date: GameDate,
  payOwnerAndBooker: boolean,
): PayrollReason {
  if (!hasStarted(employment, date)) {
    return 'notStarted';
  }
  if (onUnpaidLeave(employment, date)) {
    return 'unpaidLeave';
  }
  if (!payOwnerAndBooker && isOwnerOrBooker(employment, promotion)) {
    return 'ownerOrBooker';
  }
  if (employment.terms.monthlyWage === 0) {
    return 'noWage';
  }
  return 'paid';
}

/**
 * Every active contract of `promotion` on `date`, in employment id order, each marked paid or with
 * the reason it is not. Pure: the payroll phase and `finance.overview` both call it, so the
 * Overview card and the next Wages row agree.
 */
export function payrollLinesOf(
  read: GameWorldView,
  promotion: Pick<Promotion, 'id' | 'ownerPersonId' | 'bookerPersonId'>,
  date: GameDate,
  tunables: EngineTunables,
): PayrollLine[] {
  const payOwnerAndBooker = tunables.get('finance.payOwnerAndBooker');
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(promotion.id, 'active'))
    .map((employment) => {
      const reason = reasonFor(employment, promotion, date, payOwnerAndBooker);
      return {
        employmentId: employment.id,
        personId: employment.personId,
        name: employment.ringName,
        role: employment.role,
        monthlyWage: employment.terms.monthlyWage,
        paid: reason === 'paid',
        reason,
      };
    });
}

/** How many people medical covers: every active contract that has started, owner and booker included. */
export function medicalHeadcount(lines: readonly PayrollLine[]): number {
  return lines.filter((line) => line.reason !== 'notStarted').length;
}
