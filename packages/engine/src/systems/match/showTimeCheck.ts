/**
 * EVT4-08's booking check: a card must fit its show's time.
 *
 * `match.showTime` reads the time the card's segments take against the show's budget
 * (`showTime.ts`). Over the budget is an error ("Over the show's time by 2: shorten a match or drop
 * a segment.") once the booker has set any segment longer than usual. A card where every segment
 * keeps its usual time is never blocked: one that runs over only because its match types push
 * slots up gets the same line as a warning, so a card booked as before runs as before.
 *
 * Design: docs/design/match-rating.md#show-time and docs/design/booking.md#validation.
 */

import { registerBookingCheck } from '../booking/validate/registry';
import type {
  BookingCheck,
  BookingCheckInput,
  BookingIssueDraft,
} from '../booking/validate/types';
import { overTimeMessage, showTimeOf } from './showTime';

export const SHOW_TIME_CHECK_ID = 'match.showTime';
export const SHOW_TIME_CHECK_ORDER = 225;
export const SHOW_TIME_CHECK_LABEL = "The card fits the show's time";

/** The code of the over-time issue. */
export const OVER_TIME_CODE = 'showTime.over';

function showTimeIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const time = showTimeOf(input.read, input.instance, input.tunables);
  if (time.over <= 0) {
    return [];
  }
  return [
    {
      code: OVER_TIME_CODE,
      severity: time.lengthened ? 'error' : 'warning',
      message: overTimeMessage(time.over),
    },
  ];
}

export const showTimeCheck: BookingCheck = {
  id: SHOW_TIME_CHECK_ID,
  order: SHOW_TIME_CHECK_ORDER,
  label: SHOW_TIME_CHECK_LABEL,
  run: showTimeIssues,
};

registerBookingCheck(showTimeCheck);
