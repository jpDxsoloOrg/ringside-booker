/**
 * The calendar's commands.
 *
 * `calendar.cancelShow` calls off one show. Only the controller that runs the show may do it, and
 * only while its day has not passed. The show stays on the books as cancelled.
 *
 * Design notes: docs/design/calendar.md#cancelling-a-show.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { Reason } from '../../core/api/result';
import { isBefore } from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type { EventInstanceId } from '../../core/ids';
import { zId } from '../../model/primitives';
import { cancelShow } from './cancel';
import { controlsShow } from './control';

declare module '../../core/api/maps' {
  interface CommandMap {
    'calendar.cancelShow': { args: { eventInstanceId: EventInstanceId }; result: null };
  }
}

/** The reason codes `calendar.cancelShow` can refuse with, besides `invalidArgs`. */
export const CANCEL_SHOW_REASON_CODES = [
  'notFound',
  'notYourShow',
  'alreadyCancelled',
  'alreadyCompleted',
  'showInPast',
] as const;
export type CancelShowReasonCode = (typeof CANCEL_SHOW_REASON_CODES)[number];

const CANCEL_SHOW_MESSAGES: Readonly<Record<CancelShowReasonCode, string>> = {
  notFound: 'That show no longer exists.',
  notYourShow: 'Only the promotion (or brand) that runs this show can cancel it.',
  alreadyCancelled: 'This show has already been cancelled.',
  alreadyCompleted: 'This show has already taken place.',
  showInPast: "This show's day has passed.",
};

function refusal(code: CancelShowReasonCode, eventInstanceId?: EventInstanceId): Reason[] {
  const reason: Reason = { code, message: CANCEL_SHOW_MESSAGES[code] };
  if (eventInstanceId !== undefined) {
    reason.subject = { kind: 'eventInstance', id: eventInstanceId };
  }
  return [reason];
}

/**
 * Cancels one show. The first rule that fails is the one reported: the show must exist, the issuer
 * must be the controller that runs it, it must still be open (not cancelled, not completed) and
 * its day must not have passed. Today's show can still be cancelled before the day runs.
 */
export const cancelShowCommand = defineCommand('calendar.cancelShow', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  validate: (read, args, issuedBy) => {
    const show = read.tables.eventInstances.get(args.eventInstanceId);
    if (show === undefined) {
      return refusal('notFound');
    }
    if (!controlsShow(read, show, issuedBy)) {
      return refusal('notYourShow', show.id);
    }
    if (show.status === 'cancelled') {
      return refusal('alreadyCancelled', show.id);
    }
    if (show.status === 'completed') {
      return refusal('alreadyCompleted', show.id);
    }
    if (isBefore(show.date, read.meta.currentDate)) {
      return refusal('showInPast', show.id);
    }
    return [];
  },
  apply: (ctx, args) => {
    const show = ctx.read.tables.eventInstances.get(args.eventInstanceId);
    if (show === undefined) {
      throw new EntityNotFoundError('eventInstances', args.eventInstanceId);
    }
    cancelShow(ctx, show, 'byPromotion');
    return null;
  },
});

export const calendarCommands = [cancelShowCommand] as const;
