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
export const BOX_OFFICE_TRACE_KINDS: readonly string[] = [
  VENUE_PICK_TRACE_KIND,
  'boxOffice.attendance',
  'boxOffice.rivalAttendance',
  'boxOffice.ticketPrice',
  'boxOffice.gate',
  'boxOffice.venueRent',
  'boxOffice.liveMerch',
  'boxOffice.net',
];

/** Where the pick of a show's venue is stored. */
export function venuePickTraceRef(eventInstanceId: EventInstanceId): TraceRef {
  return { kind: VENUE_PICK_TRACE_KIND, id: eventInstanceId };
}

// Settlement (EVT6-05). Each line of the Box office section has its own kind, so busy rival
// settlement never pushes the player's breakdowns out of `sim.traceRetentionPerKind`. Rival shows
// store only a short attendance Why? (their money is private), under its own kind.

/** The crowd on the night, starting from the forecast. Id: the event instance id. */
export const ATTENDANCE_TRACE_KIND = 'boxOffice.attendance';
/** A rival show's crowd, kept short: the expected crowd, the roll and the cap. */
export const RIVAL_ATTENDANCE_TRACE_KIND = 'boxOffice.rivalAttendance';
/** The ticket price, from the company's reach and the show's size. */
export const TICKET_PRICE_TRACE_KIND = 'boxOffice.ticketPrice';
/** Ticket money kept: price × crowd − the workers' share of the gate. */
export const GATE_TRACE_KIND = 'boxOffice.gate';
/** The venue's rent. */
export const VENUE_RENT_TRACE_KIND = 'boxOffice.venueRent';
/** Merch money kept: merch sales − the workers' share of the merch. */
export const LIVE_MERCH_TRACE_KIND = 'boxOffice.liveMerch';
/** The show's box office net. */
export const NET_TRACE_KIND = 'boxOffice.net';

/** The settlement's trace kinds, in the order the Box office section shows them. */
export const SETTLEMENT_TRACE_KINDS = [
  ATTENDANCE_TRACE_KIND,
  RIVAL_ATTENDANCE_TRACE_KIND,
  TICKET_PRICE_TRACE_KIND,
  GATE_TRACE_KIND,
  VENUE_RENT_TRACE_KIND,
  LIVE_MERCH_TRACE_KIND,
  NET_TRACE_KIND,
] as const;
export type SettlementTraceKind = (typeof SETTLEMENT_TRACE_KINDS)[number];

/** Where one settlement trace of a show is stored. */
export function settlementTraceRef(
  kind: SettlementTraceKind,
  eventInstanceId: EventInstanceId,
): TraceRef {
  return { kind, id: eventInstanceId };
}
