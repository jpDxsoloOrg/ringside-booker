/**
 * Trace refs for the physical toll: where one worker's fatigue, wear, ring learning, injury chance
 * and injury roll for one segment are stored. Every ref is keyed `<segmentId>:<personId>`. MTCH4-02
 * defines them; the show-night applier (MTCH4-04) stores the traces under them.
 *
 * Design: docs/design/physical-toll.md#the-injury-roll.
 */

import type { PersonId, SegmentId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';

export const FATIGUE_TRACE_KIND = 'match.fatigue';
export const WEAR_TRACE_KIND = 'match.wear';
export const LEARNING_TRACE_KIND = 'match.learning';
export const INJURY_CHANCE_TRACE_KIND = 'match.injuryChance';
export const INJURY_ROLL_TRACE_KIND = 'match.injuryRoll';

function workerRef(kind: string, segmentId: SegmentId, personId: PersonId): TraceRef {
  return { kind, id: `${segmentId}:${personId}` };
}

/** One worker's fatigue gain in one segment. */
export function fatigueTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return workerRef(FATIGUE_TRACE_KIND, segmentId, personId);
}

/** One worker's condition wear in one segment. */
export function wearTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return workerRef(WEAR_TRACE_KIND, segmentId, personId);
}

/** One worker's ring learning in one segment. */
export function learningTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return workerRef(LEARNING_TRACE_KIND, segmentId, personId);
}

/** One worker's in-match injury chance in one segment. */
export function injuryChanceTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return workerRef(INJURY_CHANCE_TRACE_KIND, segmentId, personId);
}

/** One worker's injury roll (the "Injured in this match?" decision) in one segment. */
export function injuryRollTraceRef(segmentId: SegmentId, personId: PersonId): TraceRef {
  return workerRef(INJURY_ROLL_TRACE_KIND, segmentId, personId);
}
