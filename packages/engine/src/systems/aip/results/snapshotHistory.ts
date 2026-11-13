/**
 * DAY2's promotion snapshots as the hot-shot term's popularity history (AIP5-06).
 *
 * The readings are the promotion's weekly rows (`granularity: 'week'`) dated on or before the show,
 * newest `weeks` of them, oldest first. The value is the headline popularity roll-up DAY2 stores
 * for the promotion's own markets, the figure its Office leads with. Rows thinned to one a month,
 * and the baseline row of a new game, are not weekly readings and are left out, so a brand-new
 * game has none and reads "No popularity history yet". See
 * docs/design/rival-booking.md#popularity-history.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';
import { registerPopularityHistorySource, type PopularityReading } from './history';

export const SNAPSHOT_HISTORY_SOURCE_ID = 'office.snapshots';

/** The promotion's newest `weeks` weekly readings on or before `date`, oldest first. */
export function weeklyPopularityReadings(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  weeks: number,
): PopularityReading[] {
  if (weeks <= 0) {
    return [];
  }
  const weekly = read.tables.promotionSnapshots
    .lookup('byPromotion', promotionId)
    .filter((row) => row.granularity === 'week' && compareDates(row.date, date) <= 0)
    .sort((left, right) => compareDates(left.date, right.date));
  return weekly
    .slice(Math.max(0, weekly.length - weeks))
    .map((row) => ({ date: row.date, value: row.popularity.headline }));
}

registerPopularityHistorySource({
  id: SNAPSHOT_HISTORY_SOURCE_ID,
  read: weeklyPopularityReadings,
});
