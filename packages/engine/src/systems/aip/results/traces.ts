/**
 * The rival results' trace kinds (AIP5).
 *
 * - `aip.winner`, by segment id: why the rival booker picked a match's winner;
 * - `aip.title`, by `<segmentId>|<titleId>`: why it kept or moved one title on that match.
 *
 * Both kinds are rival-only, so `sim.traceRetentionPerKind` counts them apart from the player's
 * own breakdowns (`segment.rating` and the rest) and a busy rival schedule never pushes those out.
 * Like the card's slot traces, they are kept in full for `history.keepDetailDays` and then
 * demoted to a summary by `aip.pruneCardDetail`. See docs/design/rival-booking.md#winners.
 */

import type { SegmentId, TitleId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';

/** One rival match's winner decision, by segment id. */
export const WINNER_TRACE_KIND = 'aip.winner';
/** One title decision on a rival match, by `<segmentId>|<titleId>`. */
export const TITLE_TRACE_KIND = 'aip.title';

/** The ref of a rival match's winner decision. */
export function winnerTraceRef(segmentId: SegmentId): TraceRef {
  return { kind: WINNER_TRACE_KIND, id: segmentId };
}

/** The ref of the decision about one title on a rival match. */
export function titleTraceRef(segmentId: SegmentId, titleId: TitleId): TraceRef {
  return { kind: TITLE_TRACE_KIND, id: `${segmentId}|${titleId}` };
}
