/**
 * The people and promotions a story is about, as buzz subjects: a name for the trace, a link for
 * the Why? panel and their worldwide popularity from the shared popularity roll-up (D-03).
 *
 * Design: docs/design/news.md#buzz.
 */

import type { GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { EntityRef } from '../../core/trace';
import type { MessageRefs } from '../../model/entities/mail';
import type { GameWorldView } from '../../model/tables';
import { primaryEmploymentOf } from '../workers/helpers/employment';
import { popularityRollup } from '../world/formulas/popularityRollup';
import type { Geography } from '../world/geography';
import type { BuzzSubject } from './formulas/buzzScore';

/** The subjects of a story, and the references that no longer exist. */
export interface BuzzSubjects {
  readonly subjects: BuzzSubject[];
  readonly skipped: EntityRef[];
}

/**
 * The name a person goes by on `date`: the ring name of their main contract (the game's one
 * definition of "employer", `primaryEmploymentOf`), else their default ring name.
 */
export function displayNameOf(read: GameWorldView, personId: PersonId, date: GameDate): string {
  const employment = primaryEmploymentOf(read, personId, date);
  return employment?.ringName ?? read.tables.people.require(personId).defaultRingName;
}

/**
 * Turns a story's `personIds` and `promotionIds` into buzz subjects, people first, each list in
 * the order given. Pass one `geography` (`geographyOf(read)`) for the whole step, not one per
 * story. A person or promotion that no longer exists is skipped and listed in `skipped`.
 */
export function buzzSubjectsOf(
  read: GameWorldView,
  refs: Partial<Pick<MessageRefs, 'personIds' | 'promotionIds'>>,
  geography: Geography,
  date: GameDate = read.meta.currentDate,
): BuzzSubjects {
  const subjects: BuzzSubject[] = [];
  const skipped: EntityRef[] = [];
  for (const personId of refs.personIds ?? []) {
    const person = read.tables.people.get(personId);
    if (person === undefined) {
      skipped.push({ kind: 'person', id: personId });
      continue;
    }
    subjects.push({
      label: displayNameOf(read, personId, date),
      ref: { kind: 'person', id: personId },
      popularity: popularityRollup(person.regionalPop, geography, { valueLabel: 'Popularity' })
        .world,
    });
  }
  for (const promotionId of refs.promotionIds ?? []) {
    const promotion = read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      skipped.push({ kind: 'promotion', id: promotionId });
      continue;
    }
    subjects.push({
      label: promotion.name,
      ref: { kind: 'promotion', id: promotionId },
      popularity: popularityRollup(promotion.regionalPop, geography, {
        valueLabel: 'Popularity',
      }).world,
    });
  }
  return { subjects, skipped };
}
