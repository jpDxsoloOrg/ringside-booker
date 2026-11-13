/**
 * Big shows close together: the promotion's other major and flagship shows in the weeks before a
 * show, for big-show fatigue. Scheduled shows count as well as completed ones, so the forecast on
 * booking day and the settlement on show day agree. Design: docs/design/box-office.md#big-show-fatigue.
 */

import { addDays, compareDates, type GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import type { EventImportance } from '../../model/entities/event-definition';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** The importances that make a show big. */
export const BIG_SHOW_IMPORTANCES: readonly EventImportance[] = ['major', 'flagship'];

/** True for a major or flagship show. */
export function isBigShow(importance: EventImportance): boolean {
  return BIG_SHOW_IMPORTANCES.includes(importance);
}

export interface BigShowsQuery {
  readonly promotionId: PromotionId;
  /** The show's date. Big shows on this day or later never count. */
  readonly date: GameDate;
  /** The show itself, which never counts. */
  readonly excludeEventInstanceId: EventInstanceId | null;
  readonly tunables: EngineTunables;
}

export interface BigShowsBefore {
  readonly count: number;
  /** Their names, oldest first. */
  readonly names: string[];
}

/** The promotion's other big shows, not cancelled, in `[date − fatigue window, date)`. */
export function bigShowsBefore(read: GameWorldView, query: BigShowsQuery): BigShowsBefore {
  const windowStart = addDays(query.date, -query.tunables.get('boxOffice.fatigue.windowDays'));
  const shows = read.tables.eventInstances
    .lookup('byPromotion', query.promotionId)
    .filter(
      (instance) =>
        instance.status !== 'cancelled' &&
        isBigShow(instance.importance) &&
        instance.id !== query.excludeEventInstanceId &&
        compareDates(instance.date, windowStart) >= 0 &&
        compareDates(instance.date, query.date) < 0,
    )
    .slice()
    .sort((left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id));
  return { count: shows.length, names: shows.map((instance) => instance.name) };
}
