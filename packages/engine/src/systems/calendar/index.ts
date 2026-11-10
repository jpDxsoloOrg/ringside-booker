/**
 * The calendar system: turns event definitions into dated shows over a rolling horizon.
 *
 * A new game schedules its opening window in a setup step (`setup.ts`), and a daily phase
 * (`phases.ts`) keeps the next `calendar.scheduleHorizonDays` days on the books. Scheduling is
 * fully decided by the data, so the system has no random stream. Dates past the horizon are never
 * stored. See docs/design/calendar.md.
 */

// The event declarations are types only, and the setup step registers itself on import.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { calendarPhases } from './phases';

export { placeShow, PLACEMENT_RULES, type ShowPlacement } from './placement';
export {
  isSchedulable,
  MAX_OCCURRENCES_PER_WINDOW,
  occurrencesBetween,
  scheduleAll,
  scheduleDefinitionWindow,
  type ScheduleSummary,
} from './schedule';
export { CALENDAR_SETUP_STEP } from './setup';

export const calendarSystem: SystemBundle = defineSystem({
  id: 'calendar',
  phases: calendarPhases,
  queries: [],
  commands: [],
});
