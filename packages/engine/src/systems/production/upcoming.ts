/**
 * The shows a promotion is expected to run in a coming window, for the per-show cost estimate.
 *
 * Design: docs/design/production.md#coming-shows. The calendar's scheduled and booked shows in
 * the window win when the promotion has any; otherwise every active event definition whose
 * recurrence falls on a day of the window counts once for that day. Dates ascending, then id.
 */

import { addDays, compareDates, isAfter, isBefore, type GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import type { EventImportance } from '../../model/entities/event-definition';
import { occursOn } from '../../model/recurrence';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';

/** One show in the window. `eventInstanceId` is null for a date read off a definition. */
export interface ProductionUpcomingShow {
  name: string;
  date: GameDate;
  importance: EventImportance;
  eventInstanceId: EventInstanceId | null;
}

/** The promotion's shows from `from` (included) for `days` days. */
export function upcomingShows(
  read: GameWorldView,
  promotionId: PromotionId,
  from: GameDate,
  days: number,
): ProductionUpcomingShow[] {
  const end = addDays(from, days);
  const scheduled = read.tables.eventInstances
    .lookup('byPromotion', promotionId)
    .filter(
      (instance) =>
        (instance.status === 'scheduled' || instance.status === 'booked') &&
        !isBefore(instance.date, from) &&
        isBefore(instance.date, end),
    )
    .sort((left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id));
  if (scheduled.length > 0) {
    return scheduled.map((instance) => ({
      name: instance.name,
      date: instance.date,
      importance: instance.importance,
      eventInstanceId: instance.id,
    }));
  }

  const shows: ProductionUpcomingShow[] = [];
  const definitions = read.tables.eventDefinitions.lookup('byPromotion', promotionId);
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    for (const definition of definitions) {
      const active =
        !isBefore(date, definition.activeFrom) &&
        (definition.activeUntil === null || !isAfter(date, definition.activeUntil));
      if (active && occursOn(definition.recurrence, date)) {
        shows.push({
          name: definition.name,
          date,
          importance: definition.importance,
          eventInstanceId: null,
        });
      }
    }
  }
  return shows;
}
