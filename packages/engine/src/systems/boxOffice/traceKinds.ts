/**
 * The trace kinds the box office system stores. The forecast (`forecastAttendance`) is computed on
 * every read and never stored, so the list is empty until the show-day crowd roll and the
 * settlement (EVT6-04, EVT6-05) add theirs. Design: docs/design/box-office.md.
 */

/** Every trace kind the box office system stores. */
export const BOX_OFFICE_TRACE_KINDS: readonly string[] = [];
