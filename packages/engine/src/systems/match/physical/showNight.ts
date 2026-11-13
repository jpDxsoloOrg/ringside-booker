/**
 * MTCH4 on show night (MTCH4-04): the physical toll applier, registered at module load through
 * show night's `registerSegmentResultApplier` seam, so every match a real show runs (the player's
 * and every rival's) tires, wears and teaches its competitors.
 *
 * Order 40: after EVT3-04's title outcome (10) and MTCH3's aftermath (30), before MTCH6's
 * chemistry (50). It never reads the aftermath's output. An angle costs nothing (owner rule:
 * promos cost no stamina).
 *
 * Design: docs/design/physical-toll.md#show-night and show-night.md#segment-result-appliers.
 */

import type { PhaseContext } from '../../../core/pipeline/context';
import {
  registerSegmentResultApplier,
  type SegmentResult,
  type SegmentResultApplier,
} from '../../shows/registries';
import { applyPhysicalToll } from './apply';

export const PHYSICAL_TOLL_APPLIER_ID = 'match.physicalToll';

/** After the aftermath (30), before chemistry (50). */
export const PHYSICAL_TOLL_APPLIER_ORDER = 40;

/** Applies one run segment's physical toll. An angle writes nothing. */
export function applyPhysicalTollOnShowNight(ctx: PhaseContext, result: SegmentResult): void {
  if (result.kind !== 'match') {
    return;
  }
  applyPhysicalToll(ctx, result.segmentId);
}

export const physicalTollApplier: SegmentResultApplier = {
  id: PHYSICAL_TOLL_APPLIER_ID,
  order: PHYSICAL_TOLL_APPLIER_ORDER,
  apply: applyPhysicalTollOnShowNight,
};

registerSegmentResultApplier(physicalTollApplier);
