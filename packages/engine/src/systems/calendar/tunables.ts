/**
 * The calendar's balance numbers: how far ahead shows are stored and how far ahead they are
 * projected.
 *
 * Design notes: docs/design/calendar.md#horizon.
 */

import { defineTunables } from '../../core/tunables/define';

const CALENDAR_CATEGORY = 'Calendar';
const CALENDAR_DOC = 'calendar.md#horizon';

export const calendarTunables = defineTunables({
  'calendar.scheduleHorizonDays': {
    kind: 'integer',
    default: 90,
    min: 0,
    max: 730,
    unit: 'days',
    category: CALENDAR_CATEGORY,
    description: "How far past today shows are stored; 0 stores only today's shows",
    docRef: CALENDAR_DOC,
  },
  'calendar.projectionMaxDays': {
    kind: 'integer',
    default: 400,
    min: 0,
    max: 1100,
    unit: 'days',
    category: CALENDAR_CATEGORY,
    description: 'How far past today the calendar projects shows; 0 turns projection off',
    docRef: CALENDAR_DOC,
  },
});
