/**
 * The calendar system: turns event definitions into dated shows over a rolling horizon, and ends
 * the ones that do not happen.
 *
 * A new game schedules its opening window in a setup step (`setup.ts`), and a daily phase
 * (`phases.ts`) keeps the next `calendar.scheduleHorizonDays` days on the books. A second daily
 * phase closes shows whose day ended without them running, and `calendar.cancelShow`
 * (`commands.ts`) lets a show's controller call it off. `control.ts` is the one definition of who
 * controls a show. Screens read the schedule through the queries in `queries.ts`, which return the
 * one row shape in `view.ts` and work out the dates past the horizon on read. Nothing here is
 * random, so the system has no random stream. Dates past the horizon are never stored. See
 * docs/design/calendar.md.
 */

// The event declarations are types only, and the setup step registers itself on import.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { calendarCommands } from './commands';
import { calendarPhases } from './phases';
import { calendarQueries } from './queries';

export { cancelRefusal, cancelShow, type CancellableShow, type CancelShowContext } from './cancel';
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
  CALENDAR_RANGE_MESSAGES,
  CALENDAR_SCOPES,
  calendarQueries,
  compareCalendarShows,
  MAX_CALENDAR_RANGE_DAYS,
  nextShowQuery,
  projectedQuery,
  rangeQuery,
  showQuery,
  type CalendarProjectedView,
  type CalendarRangeView,
  type CalendarScope,
  type CalendarWindowArgs,
  type NextShowView,
} from './queries';
export { recurrenceText } from './recurrenceText';
export {
  isSchedulable,
  MAX_OCCURRENCES_PER_WINDOW,
  occurrencesBetween,
  scheduleAll,
  scheduleDefinitionWindow,
  type ScheduleSummary,
} from './schedule';
export { CALENDAR_SETUP_STEP } from './setup';
export {
  calendarRowBuilder,
  toCalendarShow,
  viewerOwnsShow,
  type CalendarRowBuilder,
  type CalendarShow,
  type CalendarShowDetail,
  type CalendarShowStatus,
} from './view';

export const calendarSystem: SystemBundle = defineSystem({
  id: 'calendar',
  phases: calendarPhases,
  queries: calendarQueries,
  commands: calendarCommands,
});
