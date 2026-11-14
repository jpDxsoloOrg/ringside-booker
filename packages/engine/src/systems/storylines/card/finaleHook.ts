/**
 * `storylines.clearFinaleOnRemove` (CRTV4-01): a segment hook that clears a storyline's finale
 * when booking removes its segment, turns it into a talking segment, or rewrites it without the
 * storyline's link. It runs inside the card writer's transaction, for the player's commands and
 * the rival booker alike, so the `finaleIsLinkedMatch` invariant holds after every booking change.
 *
 * Design: docs/design/storylines.md#linking.
 */

import type { SegmentId } from '../../../core/ids';
import type { GameTables } from '../../../model/tables';
import type { Tx } from '../../../model/tx';
import { registerSegmentHook, type SegmentHook } from '../../booking/hooks';
import { storylinesWithFinale } from './links';

export const CLEAR_FINALE_HOOK_ID = 'storylines.clearFinaleOnRemove';

function clearFinales(tx: Tx<GameTables>, segmentId: SegmentId, keepIfValid: boolean): void {
  const segment = tx.view.tables.segments.get(segmentId);
  for (const storyline of storylinesWithFinale(tx.view, segmentId)) {
    const stillValid =
      keepIfValid && segment?.kind === 'match' && segment.storylineIds.includes(storyline.id);
    if (!stillValid) {
      tx.update('storylines', storyline.id, { finaleSegmentId: null });
    }
  }
}

export const clearFinaleHook: SegmentHook = {
  id: CLEAR_FINALE_HOOK_ID,
  beforeRemove: (tx, segmentId) => {
    clearFinales(tx, segmentId, false);
  },
  afterWrite: (tx, segmentId) => {
    clearFinales(tx, segmentId, true);
  },
};

registerSegmentHook(clearFinaleHook);
