/**
 * Who may read a show's card, and whether its card can still change.
 *
 * Whose show it is lives in one place, the calendar's `control.ts` (D-06 and D-07); this file only
 * adds the booking rules on top of it and never reads a `controller` field itself.
 *
 * Design notes: docs/design/booking.md#who-may-edit-a-show.
 */

import type { Viewer } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { isBefore, type GameDate } from '../../core/date';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { viewerControlsShow } from '../calendar/control';

/** The reason codes {@link editBlockOf} returns. */
export const EDIT_BLOCK_CODES = [
  'showCompleted',
  'showCancelled',
  'showPast',
  'cardLocked',
] as const;
export type EditBlockCode = (typeof EDIT_BLOCK_CODES)[number];

/** The part of a show the card rules read. */
export type CardShow = DeepReadonly<
  Pick<EventInstance, 'id' | 'promotionId' | 'brandId' | 'status' | 'date'>
>;

/**
 * True when `viewer` may see `show`'s card while it is being booked: the omniscient viewer (tools,
 * tests and the sandbox setting) sees every card, and a controller sees the cards of the shows it
 * runs.
 */
export function canReadCard(
  read: GameWorldView,
  viewer: DeepReadonly<Viewer>,
  show: CardShow,
): boolean {
  return viewer.kind === 'omniscient' || viewerControlsShow(read, show, viewer);
}

/**
 * Why `show`'s card cannot be changed on `today`, or null when it can. The first rule that fails is
 * the one returned: the show has not run, was not cancelled, its day has not passed (today's show
 * stays editable) and its card is not locked. Who is asking is not checked here; commands check
 * that with the calendar's `controlsShow` first.
 */
export function editBlockOf(
  read: GameWorldView,
  show: CardShow,
  today: GameDate = read.meta.currentDate,
): Reason | null {
  const subject = { kind: 'eventInstance', id: show.id } as const;
  if (show.status === 'completed') {
    return { code: 'showCompleted', message: 'This show has already run', subject };
  }
  if (show.status === 'cancelled') {
    return { code: 'showCancelled', message: 'This show was cancelled', subject };
  }
  if (isBefore(show.date, today)) {
    return { code: 'showPast', message: 'This show has already happened', subject };
  }
  if (show.status === 'booked') {
    return { code: 'cardLocked', message: 'Unlock the card to change it', subject };
  }
  return null;
}
