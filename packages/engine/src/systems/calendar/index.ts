/**
 * The calendar system: turns event definitions into dated shows over a rolling horizon, and ends
 * the ones that do not happen.
 *
 * A new game schedules its opening window in a setup step (`setup.ts`), and a daily phase
 * (`phases.ts`) keeps the next `calendar.scheduleHorizonDays` days on the books. A second daily
 * phase closes shows whose day ended without them running, and `calendar.cancelShow`
 * (`commands.ts`) lets a show's controller call it off. `control.ts` is the one definition of who
 * controls a show. Nothing here is random, so the system has no random stream. Dates past the
 * horizon are never stored. See docs/design/calendar.md.
 */

// The event declarations are types only, and the setup step registers itself on import.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { calendarCommands } from './commands';
import { calendarPhases } from './phases';

export { cancelShow } from './cancel';
export { CANCEL_SHOW_REASON_CODES, cancelShowCommand, type CancelShowReasonCode } from './commands';
export {
  controlsShow,
  sameController,
  showControllerOf,
  viewerControlsShow,
  type ShowOwnership,
} from './control';
export { closePastShowsPhase, extendHorizonPhase } from './phases';
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
  commands: calendarCommands,
});
