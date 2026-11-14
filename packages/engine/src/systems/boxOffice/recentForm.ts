/**
 * Recent form: how good a promotion's recent shows were, as the average of their scores.
 *
 * Only completed shows dated strictly before the show being forecast count, so the booking-day
 * forecast and the show-day settlement see the same shows, a second show on the same day never
 * counts the first, and the show being priced never counts itself. House shows are left out
 * unless `boxOffice.recentForm.countHouseShows` is on. Design: docs/design/box-office.md#recent-form.
 */

import { addDays, compareDates, type GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import { compareIds } from '../../model/table';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';

export interface RecentFormQuery {
  readonly promotionId: PromotionId;
  /** The forecast show's date. Shows on this day or later never count. */
  readonly beforeDate: GameDate;
  /** The show being forecast or settled, which never counts towards its own form. */
  readonly excludeEventInstanceId: EventInstanceId | null;
  readonly tunables: EngineTunables;
}

export interface RecentForm {
  /** The average score of the counted shows, or null when none counted. */
  readonly averageScore: number | null;
  readonly showCount: number;
  /** The counted shows, in id order. */
  readonly eventInstanceIds: EventInstanceId[];
}

/**
 * The shows recent form counts before `beforeDate`, oldest first (ties by id). The hot streak
 * (EVT6-11) walks the same shows in this order.
 */
export function countedRecentShows(
  read: GameWorldView,
  query: RecentFormQuery,
): DeepReadonly<EventInstance>[] {
  const { tunables } = query;
  const windowStart = addDays(query.beforeDate, -tunables.get('boxOffice.recentForm.windowDays'));
  const countHouseShows = tunables.get('boxOffice.recentForm.countHouseShows');
  return read.tables.eventInstances
    .lookup('byPromotion', query.promotionId)
    .filter(
      (instance) =>
        instance.status === 'completed' &&
        instance.result !== null &&
        instance.id !== query.excludeEventInstanceId &&
        (countHouseShows || instance.importance !== 'house') &&
        compareDates(instance.date, windowStart) >= 0 &&
        compareDates(instance.date, query.beforeDate) < 0,
    )
    .slice()
    .sort((left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id));
}

/** Recent form from the shows `countedRecentShows` returned. */
export function recentFormFrom(counted: readonly DeepReadonly<EventInstance>[]): RecentForm {
  const sorted = [...counted].sort((left, right) => compareIds(left.id, right.id));
  let total = 0;
  for (const instance of sorted) {
    total += instance.result?.score ?? 0;
  }
  return {
    averageScore: sorted.length === 0 ? null : total / sorted.length,
    showCount: sorted.length,
    eventInstanceIds: sorted.map((instance) => instance.id),
  };
}

/** The promotion's recent form before `beforeDate`. */
export function recentFormOf(read: GameWorldView, query: RecentFormQuery): RecentForm {
  return recentFormFrom(countedRecentShows(read, query));
}
