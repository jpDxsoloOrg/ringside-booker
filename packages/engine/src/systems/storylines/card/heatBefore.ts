/**
 * The heat a storyline had walking into a segment (CRTV4-02).
 *
 * The heat step runs after a segment is rated, so by the time anything else looks at the result
 * the storyline's heat may already have moved. WRK8's story shield must judge a loss by the heat
 * the story had walking into the segment, not the heat after the loss's own segment moved it:
 * that is the progress row's `heatBefore` once the segment has counted, and the storyline's current
 * heat before it has (or when it never counts).
 *
 * Design: docs/design/storylines.md#heat-after-segment.
 */

import type { SegmentId, StorylineId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';

/**
 * The heat the story had walking into the segment: the progress row's `heatBefore` when the
 * segment has already counted for the storyline, else its current heat. Null for an unknown
 * storyline.
 */
export function heatBeforeSegment(
  read: GameWorldView,
  storylineId: StorylineId,
  segmentId: SegmentId,
): number | null {
  const storyline = read.tables.storylines.get(storylineId);
  if (storyline === undefined) {
    return null;
  }
  const row = storyline.progress.find((entry) => entry.segmentId === segmentId);
  return row === undefined ? storyline.heat : row.heatBefore;
}
