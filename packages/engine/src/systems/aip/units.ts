/**
 * Which promotions and brands the computer runs: the rival desk's units.
 *
 * A unit is what one rival turn acts for:
 *
 * - every `active` or `dormant` promotion whose controller is the computer (`brandId` null). Its
 *   brands with no controller of their own (or a computer one) belong to it. A brand with its own
 *   human controller (a second seat or a player GM, D-06 and D-07) is listed in `excludedBrandIds`,
 *   and every rival job leaves that brand's roster, shows and titles alone;
 * - every active brand with its own computer controller inside a promotion the computer does not
 *   run (a computer GM brand in a human promotion, BRW).
 *
 * Who controls a brand follows the same rule as `showControllerOf` (`systems/calendar/control.ts`):
 * the brand's own controller when it has one, else its promotion's. See
 * docs/design/rival-desk.md#units.
 */

import type { BrandId, PromotionId } from '../../core/ids';
import type { Controller } from '../../model/controller';
import { aiUnitKey } from '../../model/entities/ai-profile';
import type { PromotionStatus } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import { showControllerOf } from '../calendar/control';

/** One computer-run unit. `key` is `aiUnitKey(promotionId, brandId)`. */
export interface AiUnit {
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly key: string;
  /** Brands of the promotion that a human runs; rival jobs never touch them. Sorted by ID. */
  readonly excludedBrandIds: readonly BrandId[];
}

/** Promotion statuses whose computer-run promotions take turns. */
const UNIT_STATUSES: readonly PromotionStatus[] = ['active', 'dormant'];

/**
 * The controller that runs a promotion (`brandId` null) or one of its brands: the brand's own
 * controller when it has one, else the promotion's.
 *
 * @throws EntityNotFoundError when the promotion is not in the world.
 */
export function unitControllerOf(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null,
): Controller {
  return showControllerOf(read, { promotionId, brandId });
}

/** The promotion's brands with their own human controller, in ID order. */
function humanBrandIdsOf(read: GameWorldView, promotionId: PromotionId): BrandId[] {
  return read.tables.brands
    .lookup('byPromotion', promotionId)
    .filter((brand) => brand.controller?.kind === 'human')
    .map((brand) => brand.id);
}

/** Every computer-run unit in the world, sorted by `key`. */
export function computerUnits(read: GameWorldView): AiUnit[] {
  const units: AiUnit[] = [];
  for (const status of UNIT_STATUSES) {
    for (const promotion of read.tables.promotions.lookup('byStatus', status)) {
      if (promotion.controller.kind === 'computer') {
        units.push({
          promotionId: promotion.id,
          brandId: null,
          key: aiUnitKey(promotion.id, null),
          excludedBrandIds: humanBrandIdsOf(read, promotion.id),
        });
        continue;
      }
      for (const brand of read.tables.brands.lookup('byPromotion', promotion.id)) {
        if (brand.active && brand.controller?.kind === 'computer') {
          units.push({
            promotionId: promotion.id,
            brandId: brand.id,
            key: aiUnitKey(promotion.id, brand.id),
            excludedBrandIds: [],
          });
        }
      }
    }
  }
  return units.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/** True when `unit` may act on a row of `brandId` (null = the promotion's own, brandless rows). */
export function unitCovers(
  unit: AiUnit,
  promotionId: PromotionId,
  brandId: BrandId | null,
): boolean {
  if (promotionId !== unit.promotionId) {
    return false;
  }
  if (unit.brandId !== null) {
    return brandId === unit.brandId;
  }
  return brandId === null || !unit.excludedBrandIds.includes(brandId);
}

/**
 * The unit for `promotionId` (or one of its brands) whether or not the computer runs it, for the
 * queries that ask "what would a rival desk say about this roster" of any promotion, the player's
 * included. A whole computer promotion leaves out its human-run brands, exactly as its turn does;
 * any other promotion or brand covers everything it holds.
 *
 * @throws EntityNotFoundError when the promotion is not in the world.
 */
export function unitOf(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null = null,
): AiUnit {
  const promotion = read.tables.promotions.require(promotionId);
  const excludedBrandIds =
    brandId === null && promotion.controller.kind === 'computer'
      ? humanBrandIdsOf(read, promotionId)
      : [];
  return { promotionId, brandId, key: aiUnitKey(promotionId, brandId), excludedBrandIds };
}
