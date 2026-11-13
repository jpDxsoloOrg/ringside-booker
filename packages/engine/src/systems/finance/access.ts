/**
 * Who may read a promotion's books.
 *
 * A promotion's finances are private: only the seat that runs it, and the omniscient viewer (tools,
 * tests, the sandbox), may read them. Every finance query that is not public asks this first. See
 * docs/design/finances.md#queries.
 */

import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';

/** The reason code for reading a rival's books. */
export const NOT_YOUR_BOOKS = 'notYourBooks';

/** Empty when `viewer` may read the books of `promotionId`, otherwise one `notYourBooks` reason. */
export function canSeeBooks(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
): Reason[] {
  if (viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId)) {
    return [];
  }
  return [
    {
      code: NOT_YOUR_BOOKS,
      message: "Another promotion's finances are private",
      subject: { kind: 'promotion', id: promotionId },
    },
  ];
}
