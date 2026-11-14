/**
 * Who counts as working for a title's promotion. A title belongs to one promotion, and a worker
 * signed to that promotion or to its parent (a developmental territory's main promotion) may hold
 * it. CRTV1-03's orphaned-champion rule and `isEligibleHolder` both read these, so "on the roster
 * for this title" has one answer.
 *
 * Design: docs/design/titles.md#holders.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { PersonId, PromotionId } from '../../../core/ids';
import type { Employment } from '../../../model/entities/employment';
import type { GameWorldView } from '../../../model/tables';
import { activeEmploymentsOf } from '../../workers/helpers/employment';

/** The promotion and its parent, when it has one. */
export function titlePromotionIds(
  read: GameWorldView,
  promotionId: PromotionId,
): ReadonlySet<PromotionId> {
  const ids = new Set<PromotionId>([promotionId]);
  const parentId = read.tables.promotions.get(promotionId)?.parentPromotionId ?? null;
  if (parentId !== null) {
    ids.add(parentId);
  }
  return ids;
}

/**
 * The person's working contract with the title's promotion on `date` (preferred), else with its
 * parent, else null. WRK1's `activeEmploymentsOf` decides what "working" means.
 */
export function employmentForTitle(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): Employment | null {
  const ids = titlePromotionIds(read, promotionId);
  const active = activeEmploymentsOf(read, personId, date).filter((employment) =>
    ids.has(employment.promotionId),
  );
  return active.find((employment) => employment.promotionId === promotionId) ?? active[0] ?? null;
}

/** True when the person works for the promotion, or for its parent, on `date`. */
export function employedForTitle(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): boolean {
  return employmentForTitle(read, personId, promotionId, date) !== null;
}

/**
 * The last day the person's work for the promotion (or its parent) ended: the latest `endedOn`
 * among their employments with those promotions, or null when none has ended.
 */
export function lastEmployedForTitleOn(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): GameDate | null {
  const ids = titlePromotionIds(read, promotionId);
  let latest: GameDate | null = null;
  for (const employment of read.tables.employments.lookup('byPerson', personId)) {
    if (!ids.has(employment.promotionId) || employment.endedOn === null) {
      continue;
    }
    if (latest === null || compareDates(employment.endedOn, latest) > 0) {
      latest = employment.endedOn;
    }
  }
  return latest;
}

/** The ring name the person uses with the title's promotion on `date`, else their default. */
export function ringNameForTitle(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): string {
  return (
    employmentForTitle(read, personId, promotionId, date)?.ringName ??
    read.tables.people.get(personId)?.defaultRingName ??
    personId
  );
}
