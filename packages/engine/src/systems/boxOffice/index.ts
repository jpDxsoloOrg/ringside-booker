/**
 * The box office system (EVT6): every show draws a crowd the player can forecast while booking and
 * read afterwards, and that crowd pays through ECO1's `postMoney`.
 *
 * EVT6-01 lays the ground: the tunables, the random streams, the crowd forecast formula
 * (`computeExpectedAttendance` with its recent-form, big-show fatigue and hype lines) and
 * `forecastAttendance`, which gathers its inputs from the world. The bundle has no phases,
 * subscriptions, queries or commands yet; later tickets add venue picks, the show-day crowd roll and
 * the settlement. Design: docs/design/box-office.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';

export { BIG_SHOW_IMPORTANCES, bigShowsBefore, isBigShow, type BigShowsBefore } from './bigShows';
export {
  BIG_SHOW_FATIGUE_DOC_REF,
  computeBigShowFatigue,
  type BigShowFatigueInputs,
} from './formulas/bigShowFatigue';
export {
  EXPECTED_ATTENDANCE_DOC_REF,
  computeExpectedAttendance,
  type ExpectedAttendanceInputs,
} from './formulas/expectedAttendance';
export { showSizeLabel } from './formulas/labels';
export {
  RECENT_FORM_DOC_REF,
  computeRecentFormMultiplier,
  type RecentFormMultiplierInputs,
} from './formulas/recentFormMultiplier';
export { forecastAttendance, type AttendanceForecast, type ForecastPlace } from './forecast';
export { hypeLineFor, type HypeLine } from './hype';
export { recentFormOf, type RecentForm, type RecentFormQuery } from './recentForm';
export { BOX_OFFICE_CROWD_STREAM, BOX_OFFICE_MERCH_STREAM } from './streams';
export { BOX_OFFICE_TRACE_KINDS } from './traceKinds';
export { boxOfficeTunables } from './tunables';

// Show-day formulas (EVT6-04): the crowd roll, ticket price, venue rent, live merch, worker shares
// and the net they add up to. Pure; EVT6-05's settlement wires them in.
export {
  ACTUAL_ATTENDANCE_DOC_REF,
  computeActualAttendance,
  type ActualAttendanceInputs,
} from './formulas/actualAttendance';
export {
  BOX_OFFICE_NET_DOC_REF,
  computeBoxOfficeNet,
  type BoxOfficeNetInputs,
} from './formulas/boxOfficeNet';
export { LIVE_MERCH_DOC_REF, computeLiveMerch, type LiveMerchInputs } from './formulas/liveMerch';
export {
  TICKET_PRICE_DOC_REF,
  computeTicketPrice,
  type TicketPriceInputs,
} from './formulas/ticketPrice';
export { VENUE_RENT_DOC_REF, computeVenueRent, type VenueRentInputs } from './formulas/venueRent';
export {
  WORKER_SHARE_DOC_REF,
  computeWorkerShare,
  type WorkerShareInputs,
  type WorkerShareSource,
} from './formulas/workerShare';

export const boxOfficeSystem: SystemBundle = defineSystem({
  id: 'boxOffice',
  phases: [],
  subscriptions: [],
  queries: [],
  commands: [],
});
