/**
 * The box office system (EVT6): every show draws a crowd the player can forecast while booking and
 * read afterwards, and that crowd pays through ECO1's `postMoney`.
 *
 * EVT6-01 lays the ground: the tunables, the random streams, the crowd forecast formula
 * (`computeExpectedAttendance` with its recent-form, big-show fatigue and hype lines) and
 * `forecastAttendance`, which gathers its inputs from the world. EVT6-02 adds generic local venues, `showVenueOf`, `venueAvailability`, `venueFit`
 * and the venue pick (`pickVenue`, `pickVenueFor`, `applyVenueChoice`). EVT6-03 adds the venue
 * commands, the automatic picks (a daily phase and a before-a-show-runs hook) and the forecast
 * and venue queries. EVT6-05 settles every completed show (`settle.ts`): the crowd, the money
 * through `postMoney`, `show.settled`, and the `boxOffice.showCrowd` and `boxOffice.showMoney`
 * queries. Design:
 * docs/design/box-office.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { settlementQueries } from './settlementQueries';
import { settleShowSubscription } from './settleSubscription';
import { boxOfficeCommands } from './commands';
import { boxOfficePhases } from './phases';
import { boxOfficeQueries } from './queries';

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
  phases: boxOfficePhases,
  subscriptions: [settleShowSubscription],
  queries: [...boxOfficeQueries, ...settlementQueries],
  commands: boxOfficeCommands,
});

// Venues (EVT6-02): generic local venues, where a show is held and the venue pick.
export { applyVenueChoice, type ApplyVenueOptions } from './applyVenue';
export {
  PICK_VENUE_DOC_REF,
  genericOptionKey,
  genericTierOf,
  isGenericOptionKey,
  pickVenue,
  type PickVenueInputs,
  type VenueCandidate,
  type VenueOptionKey,
} from './formulas/pickVenue';
export {
  GENERIC_VENUE_IMAGE_REF,
  GENERIC_VENUE_KINDS,
  GENERIC_VENUE_TIERS,
  genericCapacityKey,
  genericVenueLabel,
  genericVenueName,
  genericVenueSizes,
  type GenericVenue,
  type GenericVenueSize,
  type GenericVenueTier,
} from './genericVenues';
export { pickVenueFor } from './pickVenueFor';
export {
  VENUE_UNAVAILABLE_CODES,
  showVenueOf,
  venueAvailability,
  type ShowVenue,
  type VenueAvailability,
  type VenueBooking,
  type VenueUnavailableCode,
} from './showVenue';
export { VENUE_PICK_TRACE_KIND, venuePickTraceRef } from './traceKinds';
export { VENUE_FITS, venueFit, venueFitLabel, type VenueFit } from './venueFit';
export { venueTunables } from './venueTunables';

// Venue commands, automatic picks and the forecast and venue queries (EVT6-03).
export {
  VENUE_OPTION_GROUPS,
  VENUE_SCOPES,
  VenueChoiceSchema,
  type SetVenueResult,
  type ShowForecast,
  type ShowVenueOptions,
  type VenueChoice,
  type VenueOption,
  type VenueOptionGroup,
  type VenueScope,
  type VenueSummary,
} from './api';
export {
  SHOW_NOT_EDITABLE_MESSAGE,
  VENUE_COMMAND_REASON_CODES,
  autoVenueCommand,
  setVenueCommand,
  type VenueCommandReasonCode,
} from './commands';
export {
  ASSIGN_VENUES_PHASE_ID,
  PICK_ON_SHOW_NIGHT_HOOK_ID,
  assignVenuesPhase,
  pickOnShowNightHook,
} from './phases';
export {
  NOT_YOUR_SHOW_FORECAST_MESSAGE,
  forecastQuery,
  showVenueQuery,
  venuesQuery,
} from './queries';
export { autoPickVenue, choiceOfKey, optionKeyOf } from './venueChoice';

// Settlement (EVT6-05): the crowd on the night and the money, the event and the queries.
export { cardWorkersOf, type CardWorker } from './cardWorkers';
export {
  BOX_OFFICE_CATEGORIES,
  BOX_OFFICE_MEMOS,
  awaitsSettlement,
  settleShow,
  type BoxOfficeCategory,
  type ShowSettlement,
} from './settle';
export { SETTLE_SHOW_SUBSCRIPTION_ID, settleShowSubscription } from './settleSubscription';
export { SETTLE_SHOWS_PHASE_ID, settleShowsPhase, showsToSettle } from './phases';
export {
  ATTENDANCE_TRACE_KIND,
  GATE_TRACE_KIND,
  LIVE_MERCH_TRACE_KIND,
  NET_TRACE_KIND,
  RIVAL_ATTENDANCE_TRACE_KIND,
  SETTLEMENT_TRACE_KINDS,
  TICKET_PRICE_TRACE_KIND,
  VENUE_RENT_TRACE_KIND,
  settlementTraceRef,
  type SettlementTraceKind,
} from './traceKinds';
export {
  NOT_SETTLED_MESSAGE,
  PRIVATE_MONEY_MESSAGE,
  SHOW_CROWD_STATUSES,
  boxOfficeRowsOf,
  seesShowMoney,
  settlementQueries,
  showCrowdQuery,
  showMoneyQuery,
  type BoxOfficeAmount,
  type ShowCrowd,
  type ShowCrowdStatus,
  type ShowMoney,
} from './settlementQueries';
