/**
 * EVT2's built-in booking checks, registered once when the booking system is loaded. They use
 * orders 100–190; other features register theirs at 200 and up.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import { registerBookingCheck } from '../registry';
import type { BookingCheck } from '../types';
import { cardWideCheck } from './cardWide';
import { peopleCheck } from './people';
import { structureCheck } from './structure';
import { titlesCheck } from './titles';
import { talkCheck } from './talk';
import { warningsCheck } from './warnings';

export { CARD_WIDE_CHECK_ID } from './cardWide';
export { PEOPLE_CHECK_ID } from './people';
export { STRUCTURE_CHECK_ID } from './structure';
export { TITLES_CHECK_ID } from './titles';
export { WARNINGS_CHECK_ID } from './warnings';

export const BUILT_IN_BOOKING_CHECKS: readonly BookingCheck[] = [
  peopleCheck,
  cardWideCheck,
  structureCheck,
  titlesCheck,
  warningsCheck,
];

for (const check of BUILT_IN_BOOKING_CHECKS) {
  registerBookingCheck(check);
}

// MTCH5-08: talk roles and settings, after the built-in checks (order 200).
export { TALK_CHECK_ID, TALK_CHECK_LABEL, talkCheck } from './talk';
registerBookingCheck(talkCheck);
