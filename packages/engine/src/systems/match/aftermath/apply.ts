/**
 * Show night's match aftermath applier (MTCH3-03): writes what one run match did to each
 * competitor's popularity and momentum.
 *
 * `applySegmentAftermath` works the aftermath out with `computeSegmentAftermath` on the step's
 * view of the world, so a worker in two matches on one card gets the second change on top of the
 * first. It then writes through WRK1's doors only, so the taper, the limits, the door traces and
 * the `popularity.changed` / `momentum.changed` events are the same as for every other change,
 * records the `match.popularityGain` and `match.momentumGain` traces, and stores one `aftermaths`
 * row per competitor with the values the doors actually wrote.
 *
 * A no contest, an angle, and anyone who was not competing (ringside, interferers, speakers,
 * subjects) write nothing. It never touches morale (D-09): losing a booked match, in a hot angle
 * or not, is not something this applier holds against anyone.
 *
 * MTCH3-05 registers it with show night (`registerSegmentResultApplier`).
 *
 * Design: docs/design/match-aftermath.md#applying-an-aftermath.
 */

import type { PersonId, RegionId, SegmentId } from '../../../core/ids';
import { refKey, type TraceRef } from '../../../core/trace/store';
import type { Aftermath, AftermathRegion } from '../../../model/entities/aftermath';
import { showControllerOf } from '../../calendar/control';
import {
  applyMomentumChange,
  applyPopularityChange,
  type DoorContext,
  type DoorReason,
  type DoorSource,
} from '../../workers/doors';
import { geographyOf } from '../../world/geography';
import { computeSegmentAftermath, hasMomentum } from './computeSegmentAftermath';

/** The trace kinds the applier stores under; the id is `<segmentId>/<personId>`. */
export const AFTERMATH_TRACE_KINDS = {
  popularity: 'match.popularityGain',
  momentum: 'match.momentumGain',
} as const;

/** Where one competitor's popularity gain trace for one match is stored. */
export function popularityGainTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return { kind: AFTERMATH_TRACE_KINDS.popularity, id: `${segmentId}/${personId}` };
}

/** Where one competitor's momentum gain trace for one match is stored. */
export function momentumGainTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return { kind: AFTERMATH_TRACE_KINDS.momentum, id: `${segmentId}/${personId}` };
}

export interface AppliedAftermath {
  /** The competitors whose aftermath was written, in the order they were written. */
  readonly personIds: readonly PersonId[];
}

/**
 * Applies one run match's aftermath. Call it after the segment's result and rating are written.
 * Writes nothing for an angle, a match with no result, or a no contest.
 */
export function applySegmentAftermath(step: DoorContext, segmentId: SegmentId): AppliedAftermath {
  const { read } = step;
  const segment = read.tables.segments.require(segmentId);
  if (
    segment.kind !== 'match' ||
    segment.outcome === null ||
    segment.outcome.kind === 'noContest'
  ) {
    return { personIds: [] };
  }
  const instance = read.tables.eventInstances.require(segment.eventInstanceId);
  const source: DoorSource = showControllerOf(read, instance).kind === 'human' ? 'player' : 'ai';
  // A rival show's gains keep only a summary (POL4-06); the rows below keep the numbers.
  const kept = { summaryOnly: source === 'ai' };
  // The door works each region out again as it writes; the preview and roll-ups are for screens.
  const aftermath = computeSegmentAftermath(read, { segmentId }, step.tunables, geographyOf(read), {
    regionDetail: false,
  });
  // The cast names the key type `Object.fromEntries` widens to string.
  const regionWeights = Object.fromEntries(
    aftermath.weights.map((line) => [line.regionId, line.weight]),
  ) as Record<RegionId, number>;

  const written: PersonId[] = [];
  for (const worker of aftermath.workers) {
    if (worker.outcome === 'noContest') {
      continue;
    }
    const reason: DoorReason = {
      key: `match.${worker.outcome}`,
      label: `${instance.name}: ${worker.resultLine}`,
    };
    const popularityRef = popularityGainTraceRef(segmentId, worker.personId);
    step.recordTrace(popularityRef, step.date, worker.popularity.delta, kept);
    const popularity = applyPopularityChange(step, {
      subject: { kind: 'person', id: worker.personId },
      regionWeights,
      delta: worker.popularity.delta,
      source,
      reason,
    });
    // The cast names the key type `Object.fromEntries` widens to string.
    const byRegion = Object.fromEntries(
      aftermath.weights.map((line): [RegionId, AftermathRegion] => [
        line.regionId,
        {
          before: popularity.before[line.regionId] ?? 0,
          after: popularity.after[line.regionId] ?? 0,
        },
      ]),
    ) as Record<RegionId, AftermathRegion>;

    let momentum: Aftermath['momentum'] = null;
    let momentumTraceId: string | null = null;
    if (hasMomentum(worker.momentum)) {
      const momentumRef = momentumGainTraceRef(segmentId, worker.personId);
      step.recordTrace(momentumRef, step.date, worker.momentum.delta, kept);
      const door = applyMomentumChange(step, {
        employmentId: worker.momentum.employmentId,
        delta: worker.momentum.delta,
        source,
        reason,
      });
      momentum = {
        employmentId: worker.momentum.employmentId,
        before: door.before,
        after: door.after ?? worker.momentum.after,
      };
      momentumTraceId = refKey(momentumRef);
    }

    step.tx.create('aftermaths', {
      segmentId,
      eventInstanceId: instance.id,
      promotionId: instance.promotionId,
      personId: worker.personId,
      date: instance.date,
      outcome: worker.outcome,
      showRegionId: aftermath.showRegionId,
      popularity: { delta: worker.popularity.delta.value, byRegion },
      momentum,
      traceIds: { popularity: refKey(popularityRef), momentum: momentumTraceId },
    });
    written.push(worker.personId);
  }
  return { personIds: written };
}
