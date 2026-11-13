/**
 * EVT5's lines in the Office's headline popularity Why? (DAY2-06, as EVT5-04 describes): a
 * "Recent shows" part listing the promotion's newest shows with what each did to its worldwide
 * popularity, so the top bar chip explains a move right after a show night.
 *
 * The office re-records the headline Why? on every `popularity.changed` (EVT5's show change is
 * written through WRK1's door, which publishes it), so these lines are current after every show.
 *
 * Design: docs/design/promotion-popularity.md#integrations, docs/design/office.md#trace-sections.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import { officeDateText } from '../office/dashboard/dateText';
import { registerPopularityTraceSection } from '../office/popularityTraceSections';
import { recentShowChanges } from './helpers';

/** The section's id in the office's trace sections registry. */
export const RECENT_SHOWS_SECTION_ID = 'promoPop.recentShows';

/** First among the sections: the shows are what usually moved the number. */
export const RECENT_SHOWS_SECTION_ORDER = 10;

/** How many shows the Why? lists. */
export const RECENT_SHOWS_IN_WHY = 3;

/** "+0.8", "−0.3" (a real minus sign) or "0.0": one decimal, as the Office shows popularity. */
export function signedPopularity(change: number): string {
  // Rounded away from zero on both sides, so +0.25 and −0.25 read alike.
  const text = (Math.round(Math.abs(change) * 10) / 10).toFixed(1);
  if (text === '0.0') return text;
  return change > 0 ? `+${text}` : `−${text}`;
}

/**
 * "Recent shows: Monday Mayhem on Mon 5 Jan, worldwide +0.8", one line per show, newest first,
 * for the shows dated on or before `date`. Empty before the promotion's first show.
 */
export function recentShowLines(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): string[] {
  return recentShowChanges(read, promotionId, Number.MAX_SAFE_INTEGER)
    .filter((change) => compareDates(change.date, date) <= 0)
    .slice(0, RECENT_SHOWS_IN_WHY)
    .map(
      (change) =>
        `Recent shows: ${change.showName} on ${officeDateText(change.date, date)}, worldwide ${signedPopularity(change.worldChange)}`,
    );
}

registerPopularityTraceSection({
  id: RECENT_SHOWS_SECTION_ID,
  order: RECENT_SHOWS_SECTION_ORDER,
  lines: recentShowLines,
});
