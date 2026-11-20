/**
 * Who may change a promotion's schedule: the controller that would run the show. It is the same
 * rule as `calendar/control.ts` (a brand with its own controller runs its shows, otherwise the
 * promotion's controller does), asked of a show that does not exist yet.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import type { Reason } from '../../../core/api/result';
import type { BrandId, PromotionId } from '../../../core/ids';
import type { Controller } from '../../../model/controller';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { controlsShow } from '../control';

export const NOT_YOUR_SHOW_MESSAGE = 'You can only change your own shows';

/**
 * The refusal when `issuedBy` does not run the shows of `promotionId` (and `brandId`, when one is
 * given), else an empty list. An unknown promotion is refused the same way.
 */
export function controlsSchedule(
  read: GameWorldView,
  owner: { readonly promotionId: PromotionId; readonly brandId: BrandId | null },
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const promotion = read.tables.promotions.get(owner.promotionId);
  const brand = owner.brandId === null ? undefined : read.tables.brands.get(owner.brandId);
  // A brand of another promotion is reported by the draft checks; ownership is the promotion's.
  const brandId = brand?.promotionId === owner.promotionId ? owner.brandId : null;
  if (
    promotion === undefined ||
    !controlsShow(read, { promotionId: promotion.id, brandId }, issuedBy)
  ) {
    return [
      {
        code: 'notYourShow',
        message: NOT_YOUR_SHOW_MESSAGE,
        subject: { kind: 'promotion', id: owner.promotionId },
      },
    ];
  }
  return [];
}
