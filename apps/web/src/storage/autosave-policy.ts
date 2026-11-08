/**
 * When to autosave. A pure function: the app's worker host asks it after each day advance and when
 * the page is hidden, and passes its answer to `writeAutosave`.
 */

import { diffDays, month, year, type GameDate } from '@ringside/engine';
import { AUTOSAVE_EVERY_DAYS } from './constants';

export { AUTOSAVE_EVERY_DAYS, BACKUP_COUNT } from './constants';

/** What prompted the check. */
export type AutosaveReason =
  /** The game moved on by one or more days. */
  | 'dayAdvanced'
  /** The page is being hidden or closed (`visibilitychange` or `pagehide`); best effort. */
  | 'pageHidden';

export interface AutosaveInput {
  /** The game date of the slot's last autosave, or null when it has none yet. */
  readonly lastAutosaveGameDate: GameDate | null;
  readonly currentGameDate: GameDate;
  /** True right after a show the player booked has run. */
  readonly playerShowJustCompleted: boolean;
  readonly reason: AutosaveReason;
}

export interface AutosaveDecision {
  readonly save: boolean;
  /** Rotate the newest save into the backups first, because a new game month started. */
  readonly monthlyBackup: boolean;
}

function isNewMonth(lastDate: GameDate, currentDate: GameDate): boolean {
  return year(lastDate) !== year(currentDate) || month(lastDate) !== month(currentDate);
}

/**
 * Decides whether to autosave now. It saves:
 * - after every completed player show;
 * - once `AUTOSAVE_EVERY_DAYS` or more in-game days have passed since the last autosave;
 * - when the game month differs from the last autosave's, with a monthly backup;
 * - when the page is hidden;
 * - when the slot has no autosave yet.
 *
 * `monthlyBackup` is true whenever the month differs from the last autosave's, so each game month
 * leaves one restore point in the backups.
 */
export function shouldAutosave(input: AutosaveInput): AutosaveDecision {
  const { lastAutosaveGameDate, currentGameDate } = input;
  if (lastAutosaveGameDate === null) {
    return { save: true, monthlyBackup: false };
  }
  const monthlyBackup = isNewMonth(lastAutosaveGameDate, currentGameDate);
  const daysSinceLast = diffDays(lastAutosaveGameDate, currentGameDate);
  const save =
    monthlyBackup ||
    input.playerShowJustCompleted ||
    input.reason === 'pageHidden' ||
    daysSinceLast >= AUTOSAVE_EVERY_DAYS;
  return { save, monthlyBackup };
}
