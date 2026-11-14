/**
 * Heat after a linked segment on show night (CRTV4-02): a segment result applier, so it runs for
 * every show that runs a card, the player's and every rival's alike (D-01: no player-only branch).
 *
 * For each storyline the segment is linked to (id order): a missing or ended storyline is skipped
 * with a log note; one with nobody from it in the segment is skipped with a log note and writes no
 * row. Otherwise `heatAfterSegment` moves its heat toward the segment's score; the storyline gets
 * the new heat, `lastProgressOn` = the show's date (so CRTV3's cooling grace restarts), a progress
 * row and its all-time totals, and `storyline.progressed` is published.
 *
 * Traces: the player's storylines keep the step under `storylines.heatStep` (`<storylineId>/<segmentId>`,
 * the row's `traceId`) and as the storyline's current `storylines.heat` Why?. A rival's heat is
 * private, so a rival storyline keeps only a summary of its current heat and no step trace, which
 * keeps rival show nights lean.
 *
 * Order 60: after show night's title outcome (10), MTCH3's aftermath (30), MTCH4's physical toll
 * (40) and MTCH6's chemistry (50). Nothing before it reads the heat it writes; WRK8's story shield
 * reads the heat walking into the segment through `heatBeforeSegment`, whatever the order.
 *
 * Design: docs/design/storylines.md#heat-after-segment.
 */

import { refKey } from '../../../core/trace/store';
import type { PhaseContext } from '../../../core/pipeline/context';
import { compareIds } from '../../../model/table';
import { SLOT_ROLE_LABELS } from '../../match/slots';
import { slotLabel } from '../../booking/view';
import {
  registerSegmentResultApplier,
  type SegmentResult,
  type SegmentResultApplier,
} from '../../shows/registries';
import { heatAfterSegment } from '../formulas/heatAfterSegment';
import { keepsFullStorylineTraces } from '../lifecycle';
import { storylineHeatStepTraceRef, storylineHeatTraceRef } from '../traceKinds';
import { membersInSegment } from './membersInSegment';
import { addToProgressTotals, appendProgress, progressOnShow } from './progressLog';

export const STORYLINE_HEAT_APPLIER_ID = 'storylines.heat';
/** After the title outcome (10), aftermath (30), physical toll (40) and chemistry (50). */
export const STORYLINE_HEAT_APPLIER_ORDER = 60;

/** How the heat trace names the segment: "Main event", "Opener", "Slot 3", "Pre-show slot 1". */
export function heatSegmentLabel(
  result: Pick<SegmentResult, 'roleKey' | 'preShow' | 'slot'>,
): string {
  if (result.preShow || result.roleKey === 'midcard' || result.roleKey === 'preShow') {
    return slotLabel(result.preShow, result.slot);
  }
  return SLOT_ROLE_LABELS[result.roleKey];
}

/** Moves the heat of every storyline the segment counts for. Never throws on bad data. */
export function applyStorylineHeat(ctx: PhaseContext, result: SegmentResult): void {
  if (result.storylineIds.length === 0) {
    return;
  }
  const storylineIds = [...result.storylineIds].sort(compareIds);
  for (const storylineId of storylineIds) {
    const storyline = ctx.read.tables.storylines.get(storylineId);
    if (storyline === undefined) {
      ctx.log(`storylines: segment ${result.segmentId} links missing storyline ${storylineId}`);
      continue;
    }
    if (storyline.status !== 'active') {
      ctx.log(`storylines: '${storyline.name}' has ended; segment ${result.segmentId} not counted`);
      continue;
    }
    if (membersInSegment(ctx.read, storyline.id, result.segmentId).length === 0) {
      ctx.log(`Not counted: nobody in this segment is in '${storyline.name}'`);
      continue;
    }
    const heatBefore = storyline.heat;
    const traced = heatAfterSegment(
      {
        heatBefore,
        segmentScore: result.score,
        storylineName: storyline.name,
        segmentLabel: heatSegmentLabel(result),
        nthOnShow: 1 + progressOnShow(storyline, result.eventInstanceId).length,
        preShow: result.preShow,
      },
      { tunables: ctx.tunables },
    );
    const heatAfter = traced.value;
    const full = keepsFullStorylineTraces(ctx.read, storyline.promotionId);
    let traceId: string | null = null;
    if (full) {
      const stepRef = storylineHeatStepTraceRef(storyline.id, result.segmentId);
      ctx.recordTrace(stepRef, result.date, traced);
      traceId = refKey(stepRef);
    }
    ctx.recordTrace(storylineHeatTraceRef(storyline.id), result.date, traced, {
      summaryOnly: !full,
    });
    ctx.tx.update('storylines', storyline.id, {
      heat: heatAfter,
      lastProgressOn: result.date,
      progress: appendProgress(storyline.progress, {
        segmentId: result.segmentId,
        eventInstanceId: result.eventInstanceId,
        date: result.date,
        heatBefore,
        heatAfter,
        traceId,
      }),
      progressTotals: addToProgressTotals(
        storyline.progressTotals,
        result.kind,
        heatBefore,
        heatAfter,
      ),
    });
    ctx.publish('storyline.progressed', {
      storylineId: storyline.id,
      promotionId: storyline.promotionId,
      segmentId: result.segmentId,
      eventInstanceId: result.eventInstanceId,
      heatBefore,
      heatAfter,
    });
  }
}

export const storylineHeatApplier: SegmentResultApplier = {
  id: STORYLINE_HEAT_APPLIER_ID,
  order: STORYLINE_HEAT_APPLIER_ORDER,
  apply: applyStorylineHeat,
};

registerSegmentResultApplier(storylineHeatApplier);
