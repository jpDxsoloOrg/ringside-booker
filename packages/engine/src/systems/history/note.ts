/**
 * The plain note screens show for history older than the detail window (POL4-08), and the cutoff
 * the roll-up uses. Kept apart from the roll-up phase so any system's query can import it without
 * pulling in the roll-up's imports.
 */

import { addDays, compareDates, type GameDate } from '../../core/date';
import type { EngineTunables } from '../tunables';

const DAYS_PER_WEEK = 7;

/** "4 weeks", "1 week", "10 days", "1 day": how long `days` of detail is, in plain words. */
export function keepDetailPeriodText(days: number): string {
  if (days > 0 && days % DAYS_PER_WEEK === 0) {
    const weeks = days / DAYS_PER_WEEK;
    return weeks === 1 ? 'week' : `${String(weeks)} weeks`;
  }
  return days === 1 ? 'day' : `${String(days)} days`;
}

/** "Details are kept for the last 4 weeks." */
export function detailKeptNoteFor(days: number): string {
  if (days <= 0) {
    return 'Details are kept only for today.';
  }
  return `Details are kept for the last ${keepDetailPeriodText(days)}.`;
}

/** The note for the current `history.keepDetailDays`. */
export function detailKeptNote(tunables: EngineTunables): string {
  return detailKeptNoteFor(tunables.get('history.keepDetailDays'));
}

/**
 * The first day still kept in detail on `today`: history dated before it is rolled up by the next
 * `history.rollUp`.
 */
export function detailKeptFrom(today: GameDate, keepDetailDays: number): GameDate {
  return addDays(today, -keepDetailDays);
}

/** True when `date` is before the detail window that ends today. */
export function isPastDetailWindow(
  date: GameDate,
  today: GameDate,
  keepDetailDays: number,
): boolean {
  return compareDates(date, detailKeptFrom(today, keepDetailDays)) < 0;
}
