/**
 * The decision log's retention rule: the first day a decision must be on or after to stay.
 *
 * A row stays while its date is after `today - retentionDays`, so 365 keeps the last 365 days and
 * 0 keeps none of the past. See docs/design/rival-desk.md#decision-log.
 */

import { addDays, compareDates, type GameDate } from '../../../core/date';

/** The newest day that is pruned: rows dated on or before it go (unless not yet revealed). */
export function decisionLogPruneThrough(today: GameDate, retentionDays: number): GameDate {
  return addDays(today, -Math.max(0, Math.floor(retentionDays)));
}

/** True when a row dated `date` and revealed on `revealOn` is past the retention period. */
export function isDecisionExpired(
  date: GameDate,
  revealOn: GameDate,
  today: GameDate,
  retentionDays: number,
): boolean {
  const pruneThrough = decisionLogPruneThrough(today, retentionDays);
  // A plan that has not aired yet stays whatever its age, so a rival's future card is never lost.
  return compareDates(date, pruneThrough) <= 0 && compareDates(revealOn, today) <= 0;
}
