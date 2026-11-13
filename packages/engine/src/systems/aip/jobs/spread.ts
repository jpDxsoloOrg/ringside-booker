/**
 * When a weekly or monthly rival job falls due for a unit, and which shows a `beforeShow` job sees.
 *
 * Weekly and monthly jobs are spread by unit: each unit gets its own weekday and its own day of
 * the month from a stable hash of its key, so eleven rivals' weekly reviews are spread over the
 * week instead of all landing on one day. A hash and not the unit's position in a list, because
 * a position shifts whenever a promotion is founded or closes, which would move every later
 * rival's review day; a hash of the unit's own key never changes. It uses the foundation's
 * frozen-output `hashString32` (`core/hash.ts`), so a save keeps its review days forever, and no
 * RNG, so asking never draws. See docs/design/rival-desk.md#jobs.
 */

import {
  addDays,
  dayOfMonth,
  makeGameDate,
  month as monthOf,
  toEpochDay,
  year as yearOf,
  type GameDate,
} from '../../../core/date';
import { hashString32 } from '../../../core/hash';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { unitCovers, type AiUnit } from '../units';
import type { AiJobCadence } from './registry';

/** Days in the week a weekly job is spread over. */
export const WEEKLY_SPREAD_DAYS = 7;
/** Days of the month a monthly job is spread over: 1 to 28, so every month has them all. */
export const MONTHLY_SPREAD_DAYS = 28;

/** Show statuses a `beforeShow` job runs for: the show is still to be run today. */
const OPEN_SHOW_STATUSES: readonly EventInstance['status'][] = ['scheduled', 'booked'];

/** The unit's stable offset, 0 to `modulo - 1`: `hashString32(unitKey) % modulo`. */
export function unitOffset(unitKey: string, modulo: number): number {
  return hashString32(unitKey) % modulo;
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

/** The unit's day of the month for monthly jobs, 1 to 28. */
export function monthlyDayOf(unitKey: string): number {
  return 1 + unitOffset(unitKey, MONTHLY_SPREAD_DAYS);
}

/**
 * The open shows (`scheduled` or `booked`) dated `date` that the unit runs, in ID order: its
 * promotion's shows, and for a brand unit only that brand's. A promotion unit never sees the
 * shows of a brand a human runs (`unitCovers`).
 */
export function unitShowsOn(
  read: GameWorldView,
  unit: AiUnit,
  date: GameDate,
): DeepReadonly<EventInstance>[] {
  return read.tables.eventInstances
    .lookup('byDate', date)
    .filter(
      (show) =>
        OPEN_SHOW_STATUSES.includes(show.status) &&
        unitCovers(unit, show.promotionId, show.brandId),
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * True when a job of `cadence` is due for `unit` on `date`. `daily` always; `weekly` on the
 * unit's weekday; `monthly` on day `1 + unitOffset(key, 28)`; `beforeShow` when the unit has an
 * open show that day (none until a calendar feature stores shows).
 */
export function isDue(
  cadence: AiJobCadence,
  unit: AiUnit,
  date: GameDate,
  read: GameWorldView,
): boolean {
  switch (cadence) {
    case 'daily':
      return true;
    case 'weekly':
      return (
        positiveModulo(
          toEpochDay(date) - unitOffset(unit.key, WEEKLY_SPREAD_DAYS),
          WEEKLY_SPREAD_DAYS,
        ) === 0
      );
    case 'monthly':
      return dayOfMonth(date) === monthlyDayOf(unit.key);
    case 'beforeShow':
      return unitShowsOn(read, unit, date).length > 0;
  }
}

/**
 * The first date on or after `from` when a weekly or monthly job is due for the unit, so screens
 * can say when the next review is. Null for `daily` and `beforeShow`, which have no fixed day.
 */
export function nextDueOn(
  cadence: AiJobCadence,
  unit: Pick<AiUnit, 'key'>,
  from: GameDate,
): GameDate | null {
  switch (cadence) {
    case 'daily':
    case 'beforeShow':
      return null;
    case 'weekly': {
      const wait = positiveModulo(
        unitOffset(unit.key, WEEKLY_SPREAD_DAYS) - toEpochDay(from),
        WEEKLY_SPREAD_DAYS,
      );
      return addDays(from, wait);
    }
    case 'monthly': {
      const target = monthlyDayOf(unit.key);
      if (dayOfMonth(from) <= target) {
        return makeGameDate(yearOf(from), monthOf(from), target);
      }
      const nextMonth = monthOf(from) === 12 ? 1 : monthOf(from) + 1;
      const nextYear = monthOf(from) === 12 ? yearOf(from) + 1 : yearOf(from);
      return makeGameDate(nextYear, nextMonth, target);
    }
  }
}
