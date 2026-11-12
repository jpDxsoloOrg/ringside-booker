/**
 * The shows system's trace kinds and the refs its traces are stored under.
 *
 * Segments on human-controlled shows and on computer-controlled shows use separate kinds, so a busy
 * rival schedule never pushes the player's breakdowns out of `sim.traceRetentionPerKind`. A stored
 * rating or result keeps its trace's ref key (`refKey(ref)`) in its `traceId`; `traceRefFromKey`
 * turns that key back into a ref. See docs/design/show-night.md#events.
 */

import type { SegmentId, EventInstanceId, TitleId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

/** A segment's score on a human-controlled show. Id: the segment id. */
export const SEGMENT_SCORE_TRACE_KIND = 'shows.segmentScore';
/** A segment's score on a computer-controlled show. Id: the segment id. */
export const RIVAL_SEGMENT_SCORE_TRACE_KIND = 'shows.rivalSegmentScore';
/** A show's score. Id: the event instance id. */
export const SHOW_SCORE_TRACE_KIND = 'shows.showScore';
/** Why a title changed hands or was kept. Id: `${segmentId}|${titleId}`. */
export const TITLE_OUTCOME_TRACE_KIND = 'shows.titleOutcome';

/**
 * How a match ended on a human-controlled show: the outcome resolver's decision, the result line's
 * winner Why? (EVT3-07). Id: the segment id.
 */
export const MATCH_RESULT_TRACE_KIND = 'match.result';
/** How a match ended on a computer-controlled show. Id: the segment id. */
export const RIVAL_MATCH_RESULT_TRACE_KIND = 'match.rivalResult';

/** Every trace kind the shows system stores. */
export const SHOWS_TRACE_KINDS = [
  SEGMENT_SCORE_TRACE_KIND,
  RIVAL_SEGMENT_SCORE_TRACE_KIND,
  SHOW_SCORE_TRACE_KIND,
  TITLE_OUTCOME_TRACE_KIND,
  MATCH_RESULT_TRACE_KIND,
  RIVAL_MATCH_RESULT_TRACE_KIND,
] as const;

/** Where a segment's score trace is stored: its own kind for human-controlled shows. */
export function segmentScoreTraceRef(segmentId: SegmentId, humanShow: boolean): TraceRef {
  return {
    kind: humanShow ? SEGMENT_SCORE_TRACE_KIND : RIVAL_SEGMENT_SCORE_TRACE_KIND,
    id: segmentId,
  };
}

/** Where a match's result trace is stored: its own kind for human-controlled shows. */
export function matchResultTraceRef(segmentId: SegmentId, humanShow: boolean): TraceRef {
  return {
    kind: humanShow ? MATCH_RESULT_TRACE_KIND : RIVAL_MATCH_RESULT_TRACE_KIND,
    id: segmentId,
  };
}

/** Where a show's score trace is stored. */
export function showScoreTraceRef(eventInstanceId: EventInstanceId): TraceRef {
  return { kind: SHOW_SCORE_TRACE_KIND, id: eventInstanceId };
}

/** Where the trace of a title's outcome in a segment is stored. */
export function titleOutcomeTraceRef(segmentId: SegmentId, titleId: TitleId): TraceRef {
  return { kind: TITLE_OUTCOME_TRACE_KIND, id: `${segmentId}|${titleId}` };
}

/**
 * The ref a stored `traceId` (a `refKey` result, `${kind}:${id}`) names, or null when the key has
 * no `:` or an empty kind or id. Splits on the first `:`, since kinds cannot contain one.
 */
export function traceRefFromKey(key: string): TraceRef | null {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return { kind: key.slice(0, separator), id: key.slice(separator + 1) };
}
