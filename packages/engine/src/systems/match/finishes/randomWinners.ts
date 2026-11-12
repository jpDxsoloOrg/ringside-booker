/**
 * Whether Random winners applies to a show (MTCH2-03): the `randomWinners` new-game setting is on
 * **and** the show is run by a human. The controller is the brand's when the show's brand has one,
 * else the promotion's. Computer bookers keep their own logic, so rival shows are never affected.
 *
 * Design: docs/design/match-finishes.md#random-winners.
 */

import type { BrandId, PromotionId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';
import { getSetting } from '../../newgame/settings';
// The setting must be registered before `getSetting` can read it.
import '../settings';

export interface RandomWinnersArgs {
  /** The promotion running the show. */
  readonly promotionId: PromotionId;
  /** The show's brand, or null for a promotion-wide show. */
  readonly brandId: BrandId | null;
}

/** True when Random winners decides the results of this show. */
export function randomWinnersActive(read: GameWorldView, args: RandomWinnersArgs): boolean {
  if (!getSetting(read, 'randomWinners')) {
    return false;
  }
  const promotion = read.tables.promotions.get(args.promotionId);
  if (promotion === undefined) {
    return false;
  }
  const brand = args.brandId === null ? undefined : read.tables.brands.get(args.brandId);
  const controller = brand?.controller ?? promotion.controller;
  return controller.kind === 'human';
}
