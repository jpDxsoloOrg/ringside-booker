/**
 * The booking system's balance numbers: the thresholds the booking checks (EVT2-04) hold a card
 * to before its show can run.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import { defineTunables } from '../../core/tunables/define';

const BOOKING_CATEGORY = 'Booking';
const VALIDATION_DOC = 'booking.md#validation';

export const bookingTunables = defineTunables({
  'booking.maxAppearancesPerShow': {
    kind: 'integer',
    default: 4,
    min: 1,
    max: 6,
    unit: 'count',
    category: BOOKING_CATEGORY,
    description: 'Most segments of any kind one person may appear in on one show',
    docRef: VALIDATION_DOC,
  },
  'booking.maxMatchesPerPersonPerShow': {
    kind: 'integer',
    default: 3,
    min: 1,
    max: 4,
    unit: 'count',
    category: BOOKING_CATEGORY,
    description:
      'Most matches one person may wrestle on one show (each match past the first is a warning)',
    docRef: VALIDATION_DOC,
  },
  'booking.minFilledMainShare': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: BOOKING_CATEGORY,
    description:
      'Share of main-card slots that must be filled before the show can run (0 = no minimum)',
    docRef: VALIDATION_DOC,
  },
  'booking.requireMainEvent': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: BOOKING_CATEGORY,
    description: 'A show can only run with its main event (the last main-card slot) filled',
    docRef: VALIDATION_DOC,
  },
});
