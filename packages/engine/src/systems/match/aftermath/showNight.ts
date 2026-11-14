/**
 * MTCH3 on show night (MTCH3-05): the aftermath applier, registered at module load through show
 * night's `registerSegmentResultApplier` seam, so every match a real show runs moves its
 * competitors' popularity and momentum.
 *
 * Order 30: after EVT3-04's title outcome (10), so a match that changed a title is already
 * settled, and before MTCH4's physical toll (40) and MTCH6's chemistry (50). Nothing that reads
 * popularity runs later in the same step.
 *
 * It never touches morale (D-09): `applySegmentAftermath` and MTCH5-06's `applyAngleAftermath`
 * write popularity and momentum through WRK1's doors only.
 *
 * Design: docs/design/match-aftermath.md#integrations and show-night.md#segment-result-appliers.
 */

import {
  registerSegmentResultApplier,
  type SegmentResult,
  type SegmentResultApplier,
} from '../../shows/registries';
import type { PhaseContext } from '../../../core/pipeline/context';
import { applyAngleAftermath } from '../angles/aftermath';
import { applySegmentAftermath } from './apply';

export const AFTERMATH_APPLIER_ID = 'match.aftermath';

/** After the title outcome (10), before the physical toll (40). */
export const AFTERMATH_APPLIER_ORDER = 30;

/**
 * Applies one run segment's aftermath. An angle gets MTCH5-06's angle aftermath (momentum and
 * popularity by each person's share of the beats); a match with no winner or loser writes nothing.
 */
export function applyAftermathOnShowNight(ctx: PhaseContext, result: SegmentResult): void {
  if (result.kind === 'angle') {
    applyAngleAftermath(ctx, result.segmentId, result.roleKey);
    return;
  }
  if (result.kind !== 'match' || result.outcome === null || result.outcome.kind === 'noContest') {
    return;
  }
  applySegmentAftermath(ctx, result.segmentId);
}

export const aftermathApplier: SegmentResultApplier = {
  id: AFTERMATH_APPLIER_ID,
  order: AFTERMATH_APPLIER_ORDER,
  apply: applyAftermathOnShowNight,
};

registerSegmentResultApplier(aftermathApplier);
