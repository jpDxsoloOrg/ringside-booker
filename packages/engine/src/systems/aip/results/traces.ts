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
import type { Traced, TraceNode, TraceValue } from '../../../core/trace';
import { countTraceNodes, truncationNote } from '../../../core/trace/limits';
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

/** Levels kept in a stored `aip.winner` trace: the result, who wins, each side's value and its steps. */
export const WINNER_TRACE_DEPTH = 4;
/** Levels kept in a stored `aip.title` trace: the decision, the chance and pool, and their steps. */
export const TITLE_TRACE_DEPTH = 3;

/**
 * Cuts a trace below `maxDepth` levels (the root is level 1): a node on the last kept level keeps
 * its own value but its explanation becomes one "N more steps not shown" note, which carries the
 * node's number so the trace still replays. Rival results are stored for every rival show, so
 * the deep parts (each tunable's wording, how a taste or a prestige was worked out) are left to the
 * formulas' own Why?s and the docs. See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */
export function compactTrace<T extends TraceValue>(traced: Traced<T>, maxDepth: number): Traced<T> {
  return { value: traced.value, trace: cutBelow(traced.trace, 1, maxDepth) };
}

function cutBelow(node: TraceNode, depth: number, maxDepth: number): TraceNode {
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return node;
  }
  if (depth < maxDepth) {
    return { ...node, children: children.map((child) => cutBelow(child, depth + 1, maxDepth)) };
  }
  const hidden = children.reduce((sum, child) => sum + countTraceNodes(child), 0);
  const value = typeof node.value === 'number' ? node.value : null;
  return { ...node, children: [truncationNote(hidden, value)] };
}
