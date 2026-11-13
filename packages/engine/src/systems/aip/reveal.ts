/**
 * When a viewer may see a rival's decision: the one reveal rule.
 *
 * A rival's plan stays hidden from other controllers until it has aired. Every AIP query that
 * hides plans (the decision log, AIP4's `aip.showCards`, AIP5's `aip.segmentDecision`) asks this
 * function, so they cannot disagree. See docs/design/rival-desk.md#decision-log.
 */

import type { Viewer } from '../../core/api/controller';
import { isBefore, type GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import { canSeePrivate, visibilityOf } from './visibility';

/**
 * True when `viewer` may see a decision of `promotionId` that reveals on `revealOn`: always for the
 * all-seeing viewer, in a sandbox game and for the promotion's own controller; for anyone else once
 * `revealOn` is before the world's current date. The reveal day itself has to be simulated first,
 * so a show that airs on `revealOn` has aired: on that day the plan is still hidden, the next day
 * it shows.
 */
export function isRevealedTo(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
  revealOn: GameDate,
): boolean {
  return (
    canSeePrivate(visibilityOf(read, viewer, promotionId)) ||
    isBefore(revealOn, read.meta.currentDate)
  );
}
