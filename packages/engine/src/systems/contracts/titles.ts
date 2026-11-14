/**
 * `titlesHeldBy`: the titles a person holds right now.
 *
 * The contracts system's own reading of the title reigns, used by the simple rival renewal's "holds
 * a title" rule, and later by the release warning and the contract list chips (ECO4-02/04). CRTV1
 * brings the creative system's `titlesHeldBy`; ECO4-05 swaps this one for it when CRTV1 is on main.
 */

import type { PersonId, PromotionId, TitleId } from '../../core/ids';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';

/**
 * The titles `personId` holds today (open reigns only), in ID order. With `promotionId`, only that
 * promotion's titles.
 */
export function titlesHeldBy(
  read: GameWorldView,
  personId: PersonId,
  promotionId?: PromotionId,
): TitleId[] {
  const held = new Set<TitleId>();
  for (const reign of read.tables.titleReigns.lookup('byHolder', personId)) {
    if (reign.lostOn !== null) {
      continue;
    }
    if (promotionId !== undefined) {
      const title = read.tables.titles.get(reign.titleId);
      if (title?.promotionId !== promotionId) {
        continue;
      }
    }
    held.add(reign.titleId);
  }
  return [...held].sort(compareIds);
}
