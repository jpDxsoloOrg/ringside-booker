/**
 * Who a person works for. These are the only definitions of "employer" and "free agent": every
 * worker query asks them instead of reading the employments table its own way.
 */

import { compareDates, isAfter, type GameDate } from '../../../core/date';
import type { PersonId } from '../../../core/ids';
import type { Employment } from '../../../model/entities/employment';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';

/**
 * The person's working contracts on `date`: status `active` and started on or before the date, in
 * ascending ID order. Offers, signed contracts that have not started and ended contracts are left
 * out.
 */
export function activeEmploymentsOf(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
): Employment[] {
  return read.tables.employments
    .lookup('byPerson', personId)
    .filter((employment) => employment.status === 'active' && !isAfter(employment.startsOn, date));
}

function isExclusiveWritten(employment: Employment): boolean {
  return employment.terms.kind === 'written' && employment.terms.exclusive;
}

/**
 * The person's main employer on `date`, or null for a free agent: an exclusive written contract
 * first, then the contract that started earliest, then the lowest ID.
 */
export function primaryEmploymentOf(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
): Employment | null {
  const [primary] = activeEmploymentsOf(read, personId, date).sort((left, right) => {
    const exclusiveOrder = Number(isExclusiveWritten(right)) - Number(isExclusiveWritten(left));
    if (exclusiveOrder !== 0) {
      return exclusiveOrder;
    }
    const startOrder = compareDates(left.startsOn, right.startsOn);
    return startOrder !== 0 ? startOrder : compareIds(left.id, right.id);
  });
  return primary ?? null;
}

/** True when the person has no working contract on `date`. */
export function isFreeAgent(read: GameWorldView, personId: PersonId, date: GameDate): boolean {
  return activeEmploymentsOf(read, personId, date).length === 0;
}
