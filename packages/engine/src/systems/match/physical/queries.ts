/**
 * `match.physicalForSegment` (MTCH4-04): what one run match did to each competitor's body, read
 * from the physical toll traces show night stored (`apply.ts`): fatigue gained and where it ended,
 * condition lost, ring learning, the injury chance and whether they were hurt, each with the ref of
 * its Why? while the store still has it.
 *
 * A number is null when its trace is gone (pruned past the store's limits) or was never kept (a
 * rival show stores no learning). The fatigue gain is the "Fatigue from this match" step of the
 * fatigue trace, which a summary keeps too.
 *
 * Viewer scoping: physical numbers are not secret, so every viewer gets the same answer. Learning
 * is a gain only; potential and ceilings never reach a trace (docs/design/physical-toll.md#ring-learning).
 *
 * Design: docs/design/physical-toll.md#show-night.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition, type TraceReader } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import type { PersonId, SegmentId } from '../../../core/ids';
import { isFullTrace, type TraceRef } from '../../../core/trace/store';
import { promotionStatusKey } from '../../../model/entities/employment';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import { FATIGUE_FROM_MATCH_LABEL } from './apply';
import {
  fatigueTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
  learningTraceRef,
  wearTraceRef,
} from './traceRefs';

export const PHYSICAL_FOR_SEGMENT_NOT_FOUND = "That segment doesn't exist.";

export interface PhysicalForSegmentArgs {
  readonly segmentId: SegmentId;
}

const PhysicalForSegmentArgsSchema = z.strictObject({ segmentId: zId('segment') });

/** One number and the ref of its Why?, or nulls when the trace is not kept. */
export interface PhysicalNumber {
  readonly value: number | null;
  readonly traceRef: TraceRef | null;
}

export interface PhysicalWorkerRow {
  readonly personId: PersonId;
  readonly name: string;
  /** The stored side, 0-based. */
  readonly side: number;
  readonly fatigueGain: PhysicalNumber;
  readonly fatigueAfter: PhysicalNumber;
  /** Condition lost over the whole body. */
  readonly wearTotal: PhysicalNumber;
  /** Ring learning gained in the match, all attributes together. */
  readonly learning: PhysicalNumber;
  /** 0..1. */
  readonly injuryChance: PhysicalNumber;
  /** Hurt in this match; the ref is the "Injured in this match?" decision. */
  readonly injured: { readonly value: boolean; readonly traceRef: TraceRef | null };
}

export interface PhysicalForSegmentResult {
  /** False until show night has run the match (or for an angle, which has no physical toll). */
  readonly applied: boolean;
  /** Competitors, by side then person id. */
  readonly workers: readonly PhysicalWorkerRow[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'match.physicalForSegment': {
      args: PhysicalForSegmentArgs;
      result: PhysicalForSegmentResult;
    };
  }
}

function numberOf(traces: TraceReader, ref: TraceRef): PhysicalNumber {
  const entry = traces.get(ref);
  return entry === undefined || typeof entry.value !== 'number'
    ? { value: null, traceRef: null }
    : { value: entry.value, traceRef: ref };
}

/** The fatigue trace's "Fatigue from this match" step, from the full trace or its summary. */
function fatigueGainOf(traces: TraceReader, ref: TraceRef): PhysicalNumber {
  const entry = traces.get(ref);
  if (entry === undefined) {
    return { value: null, traceRef: null };
  }
  if (isFullTrace(entry)) {
    const step = entry.trace.children?.find((child) => child.label === FATIGUE_FROM_MATCH_LABEL);
    return { value: step?.kind === 'add' ? step.operand : null, traceRef: ref };
  }
  const step = entry.topContributors.find(
    (contributor) => contributor.label === FATIGUE_FROM_MATCH_LABEL,
  );
  // A summary leaves out a step with no effect: a gain of 0.
  return { value: step?.effect ?? 0, traceRef: ref };
}

export const physicalForSegmentQuery: QueryDefinition<'match.physicalForSegment'> = defineQuery(
  'match.physicalForSegment',
  {
    args: PhysicalForSegmentArgsSchema,
    run: (ctx, args) => {
      const { read, traces } = ctx;
      const segment = read.tables.segments.get(args.segmentId);
      if (segment === undefined) {
        return refuseQuery({
          code: 'notFound',
          message: PHYSICAL_FOR_SEGMENT_NOT_FOUND,
          field: 'segmentId',
        });
      }
      if (segment.kind !== 'match') {
        return { applied: false, workers: [] };
      }
      const instance = read.tables.eventInstances.require(segment.eventInstanceId);
      const ringNames = new Map(
        read.tables.employments
          .lookup('byPromotionStatus', promotionStatusKey(instance.promotionId, 'active'))
          .map((employment) => [employment.personId, employment.ringName]),
      );
      const competitors = read.tables.participants
        .lookup('bySegment', segment.id)
        .filter((participant) => participant.role === 'competitor')
        .sort((left, right) => left.side - right.side || compareIds(left.personId, right.personId));
      const workers = competitors.map((participant): PhysicalWorkerRow => {
        const { personId } = participant;
        const rollRef = injuryRollTraceRef(segment.id, personId);
        const hurt = traces.has(rollRef);
        return {
          personId,
          name:
            ringNames.get(personId) ??
            read.tables.people.get(personId)?.defaultRingName ??
            personId,
          side: participant.side,
          fatigueGain: fatigueGainOf(traces, fatigueTraceRef(segment.id, personId)),
          fatigueAfter: numberOf(traces, fatigueTraceRef(segment.id, personId)),
          wearTotal: numberOf(traces, wearTraceRef(segment.id, personId)),
          learning: numberOf(traces, learningTraceRef(segment.id, personId)),
          injuryChance: numberOf(traces, injuryChanceTraceRef(segment.id, personId)),
          injured: { value: hurt, traceRef: hurt ? rollRef : null },
        };
      });
      return { applied: segment.rating !== null, workers };
    },
  },
);

export const physicalQueries: readonly QueryDefinition[] = [physicalForSegmentQuery];
