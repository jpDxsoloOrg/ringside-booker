/**
 * Who else is talking to a worker (ECO5-04). Other promotions' open talks are shown by name only:
 * never their terms, rounds or amounts (D-07, per-viewer views).
 *
 * Design: docs/design/negotiation.md#commands.
 */

import type { PersonId, PromotionId } from '../../core/ids';
import { isOpenNegotiationStatus } from '../../model/entities/negotiation';
import type { GameWorldView } from '../../model/tables';

/** Names of the other promotions with open talks for `personId`, sorted by name, each once. */
export function competingBidders(
  read: GameWorldView,
  personId: PersonId,
  exceptPromotionId: PromotionId,
): string[] {
  const names = new Set<string>();
  for (const negotiation of read.tables.negotiations.lookup('byPerson', personId)) {
    if (
      negotiation.promotionId === exceptPromotionId ||
      !isOpenNegotiationStatus(negotiation.status)
    ) {
      continue;
    }
    const name = read.tables.promotions.get(negotiation.promotionId)?.name;
    if (name !== undefined && name !== '') {
      names.add(name);
    }
  }
  return [...names].sort();
}
