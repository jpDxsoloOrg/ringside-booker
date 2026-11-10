/**
 * Cancelling a show: the one write both ways of cancelling share.
 *
 * The row is kept, never deleted. Its place in the unique `byDefinitionAirDate` index stays taken,
 * which is what stops the daily horizon from scheduling the same show again.
 *
 * Design notes: docs/design/calendar.md#lifecycle.
 */

import { isBefore, type GameDate } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import type { Controller } from '../../model/controller';
import type { CancellationReason, EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { controlsShow } from './control';

/** The reason codes `calendar.cancelShow` can refuse with, besides `invalidArgs`. */
export const CANCEL_SHOW_REASON_CODES = [
  'notFound',
  'notYourShow',
  'alreadyCancelled',
  'alreadyCompleted',
  'showInPast',
] as const;
export type CancelShowReasonCode = (typeof CANCEL_SHOW_REASON_CODES)[number];

/** The part of a show the cancel rules read. */
export type CancellableShow = DeepReadonly<
  Pick<EventInstance, 'promotionId' | 'brandId' | 'status' | 'date'>
>;

/**
 * Why `controller` may not cancel `show` on `today`, or null when it may. The first rule that fails is
 * the one returned: the controller must run the show, the show must still be open (not cancelled,
 * not completed) and its day must not have passed. The command and the calendar rows both ask
 * here, so a row's `canCancel` can never disagree with what the command then does.
 */
export function cancelRefusal(
  read: GameWorldView,
  show: CancellableShow,
  controller: DeepReadonly<Controller>,
  today: GameDate = read.meta.currentDate,
): Exclude<CancelShowReasonCode, 'notFound'> | null {
  if (!controlsShow(read, show, controller)) {
    return 'notYourShow';
  }
  if (show.status === 'cancelled') {
    return 'alreadyCancelled';
  }
  if (show.status === 'completed') {
    return 'alreadyCompleted';
  }
  if (isBefore(show.date, today)) {
    return 'showInPast';
  }
  return null;
}

/**
 * Marks `show` cancelled today for `reason` and publishes `show.cancelled`. The show's segments
 * are left as they are.
 */
export function cancelShow(
  ctx: PhaseContext,
  show: DeepReadonly<Pick<EventInstance, 'id' | 'promotionId' | 'date'>>,
  reason: CancellationReason,
): void {
  ctx.tx.update('eventInstances', show.id, {
    status: 'cancelled',
    cancellation: { reason, on: ctx.date },
  });
  ctx.publish('show.cancelled', {
    eventInstanceId: show.id,
    promotionId: show.promotionId,
    date: show.date,
    reason,
  });
}
