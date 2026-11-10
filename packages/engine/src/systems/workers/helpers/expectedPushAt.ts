/**
 * Expected push and footprint popularity for a person and a promotion in the world: the inputs are
 * gathered from the people, promotions and map tables so every caller measures the same thing.
 */

import type { PersonId, PromotionId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import type { EmploymentRole, Push } from '../../../model/entities/employment';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { geographyOf } from '../../world/geography';
import { expectedPush } from '../formulas/expectedPush';
import { footprintPopularity } from '../formulas/footprintPopularity';
import { activeEmploymentsOf, primaryEmploymentOf } from './employment';
import { mainRoleOf } from './roles';

/**
 * The job the person has at the promotion today, or, when they do not work there, the job they are
 * known for (a free agent wrestler would be hired as a wrestler).
 */
function roleAt(read: GameWorldView, personId: PersonId, promotionId: PromotionId): EmploymentRole {
  const today = read.meta.currentDate;
  const there = activeEmploymentsOf(read, personId, today).find(
    (employment) => employment.promotionId === promotionId,
  );
  if (there !== undefined) {
    return there.role;
  }
  const person = read.tables.people.require(personId);
  return mainRoleOf(person, primaryEmploymentOf(read, personId, today));
}

/**
 * The card position `personId` would expect at `promotionId` today. Throws `EntityNotFoundError`
 * for an unknown person or promotion.
 */
export function expectedPushAt(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Traced<Push> {
  const person = read.tables.people.require(personId);
  const promotion = read.tables.promotions.require(promotionId);
  return expectedPush(
    {
      employmentRole: roleAt(read, personId, promotionId),
      workerPop: person.regionalPop,
      promotionPop: promotion.regionalPop,
      promotionName: promotion.name,
      regions: geographyOf(read).regions,
    },
    { tunables },
  );
}

/**
 * How well known `personId` is among `promotionId`'s fans today. Throws `EntityNotFoundError` for
 * an unknown person or promotion.
 */
export function footprintPopularityAt(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Traced<number> {
  const person = read.tables.people.require(personId);
  const promotion = read.tables.promotions.require(promotionId);
  return footprintPopularity(
    {
      subjectPop: person.regionalPop,
      promotionPop: promotion.regionalPop,
      promotionName: promotion.name,
      regions: geographyOf(read).regions,
    },
    { tunables },
  );
}
