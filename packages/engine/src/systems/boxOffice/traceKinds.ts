/**
 * The trace kinds the box office system stores. The forecast (`forecastAttendance`) is computed on
 * every read and never stored. The venue pick (EVT6-02) is stored once per show; the show-day crowd
 * roll and the settlement (EVT6-04, EVT6-05) add theirs. Design: docs/design/box-office.md.
 */

import type { EventInstanceId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

/** Why a show's venue was picked. Id: the event instance id. */
export const VENUE_PICK_TRACE_KIND = 'boxOffice.venuePick';

/** Every trace kind the box office system stores. */
export const BOX_OFFICE_TRACE_KINDS: readonly string[] = [VENUE_PICK_TRACE_KIND];

/** Where the pick of a show's venue is stored. */
export function venuePickTraceRef(eventInstanceId: EventInstanceId): TraceRef {
  return { kind: VENUE_PICK_TRACE_KIND, id: eventInstanceId };
}
