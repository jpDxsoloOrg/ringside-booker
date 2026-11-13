/**
 * The box office system (EVT6): every show draws a crowd the player can forecast while booking and
 * read afterwards, and that crowd pays through ECO1's `postMoney`.
 *
 * EVT6-01 lays the ground: the tunables, the random streams, the crowd forecast formula
 * (`computeExpectedAttendance` with its recent-form, big-show fatigue and hype lines) and
 * `forecastAttendance`, which gathers its inputs from the world. The bundle has no phases,
 * subscriptions, queries or commands yet; later tickets add venue picks, the show-day crowd roll and
 * the settlement. EVT6-02 adds generic local venues, `showVenueOf`, `venueAvailability`, `venueFit`
 * and the venue pick (`pickVenue`, `pickVenueFor`, `applyVenueChoice`). Design:
 * docs/design/box-office.md.
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

export const boxOfficeSystem: SystemBundle = defineSystem({
  id: 'boxOffice',
  phases: [],
  subscriptions: [],
  queries: [],
  commands: [],
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
