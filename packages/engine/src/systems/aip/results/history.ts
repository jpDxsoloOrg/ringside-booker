/**
 * The popularity history seam for the hot-shot term (AIP5).
 *
 * A rival booker moves a title sooner while its promotion keeps losing fans. That needs weekly
 * popularity readings, which DAY2's promotion snapshots keep; this file only lets one source plug
 * in (AIP5-06 registers DAY2's, in `snapshotHistory.ts`). With no source, `popularityHistoryOf` returns null and the title
 * decision notes "No popularity history yet" and adds nothing. See
 * docs/design/rival-booking.md#title-changes.
 */

import type { GameDate } from '../../../core/date';
import { RegistryError } from '../../../core/errors';
import type { PromotionId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';

/** One weekly reading of a promotion's popularity. */
export interface PopularityReading {
  readonly date: GameDate;
  readonly value: number;
}

/** Where weekly popularity readings come from. */
export interface PopularityHistorySource {
  readonly id: string;
  /**
   * Up to `weeks` readings on or before `date`, oldest first, or null when the source has none
   * for the promotion.
   */
  readonly read: (
    read: GameWorldView,
    promotionId: PromotionId,
    date: GameDate,
    weeks: number,
  ) => readonly PopularityReading[] | null;
}

/** What the title decision notes when no source is registered or it has nothing yet. */
export const NO_POPULARITY_HISTORY_NOTE = 'No popularity history yet';

let registered: PopularityHistorySource | null = null;

/**
 * Plugs in the popularity history source. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError when a source is already registered: there is at most one.
 */
export function registerPopularityHistorySource(source: PopularityHistorySource): () => void {
  if (registered !== null) {
    throw new RegistryError(
      `Popularity history source "${source.id}": "${registered.id}" is already registered, and there can be only one`,
      { sourceId: source.id },
    );
  }
  const stored: PopularityHistorySource = Object.freeze({ id: source.id, read: source.read });
  registered = stored;
  return () => {
    if (registered === stored) {
      registered = null;
    }
  };
}

/**
 * The promotion's last `weeks` weekly popularity readings on or before `date`, oldest first, or
 * null when no source is registered or it has none.
 */
export function popularityHistoryOf(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  weeks: number,
): PopularityReading[] | null {
  if (registered === null) {
    return null;
  }
  const readings = registered.read(read, promotionId, date, weeks);
  return readings === null ? null : [...readings];
}
