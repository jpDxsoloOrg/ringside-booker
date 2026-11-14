/**
 * The order reigns happened in, for the lineage's numbers and the records' ties.
 *
 * A reign row has dates, not times, and its ID is random, so two reigns that started on the same
 * day (the booker awards a title, then awards it to someone else, or a champion loses it on show
 * night) need a rule. Reigns never overlap, so of two reigns that started the same day the one that
 * ended that day came first: order by `lostOn` (the current reign last). When both ended that day,
 * a reign that was handed over (lost, stripped, unified) came before one that left the title
 * empty (vacated, retired), since a hand-over always starts the next reign at once. Only then the
 * ID, so the order is at least stable.
 *
 * Design: docs/design/titles.md#lineage-order.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { TitleReignId } from '../../../core/ids';
import type { ReignEndReason } from '../../../model/entities/title-reign';
import { compareIds } from '../../../model/table';

/** What the order needs from a reign. */
export interface OrderedReign {
  readonly id: TitleReignId;
  readonly wonOn: GameDate;
  /** Null while the reign is current. */
  readonly lostOn: GameDate | null;
  /** Null while the reign is current, or when the caller doesn't know it. */
  readonly endReason?: ReignEndReason | null;
}

const HANDED_OVER: ReadonlySet<ReignEndReason> = new Set(['lost', 'stripped', 'unified']);

/** 0 for a reign whose title went straight to someone else, 1 otherwise. */
function emptyAfter(reign: OrderedReign): number {
  return reign.endReason != null && HANDED_OVER.has(reign.endReason) ? 0 : 1;
}

/** Oldest first; see the module comment for same-day reigns. */
export function compareReignsChronologically(left: OrderedReign, right: OrderedReign): number {
  return (
    compareDates(left.wonOn, right.wonOn) ||
    compareLostOn(left.lostOn, right.lostOn) ||
    emptyAfter(left) - emptyAfter(right) ||
    compareIds(left.id, right.id)
  );
}

function compareLostOn(left: GameDate | null, right: GameDate | null): number {
  if (left === null || right === null) {
    return Number(left === null) - Number(right === null);
  }
  return compareDates(left, right);
}
