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
import { diffDays, type GameDate } from '../../../core/date';
import type {
  EventInstanceId,
  InjuryId,
  PersonId,
  PromotionId,
  SegmentId,
} from '../../../core/ids';
import { isFullTrace, type TraceRef } from '../../../core/trace/store';
import { injuryKindOf } from '../../../model/catalogs';
import { promotionStatusKey } from '../../../model/entities/employment';
import type { BodyPart } from '../../../model/entities/person';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import { injuryTraceRef } from '../../health/injure';
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

/** Ring names under the show's promotion, for the names a results page shows. */
function ringNamesOf(
  read: GameWorldView,
  promotionId: PromotionId,
): (personId: PersonId) => string {
  const ringNames = new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
      .map((employment) => [employment.personId, employment.ringName]),
  );
  return (personId) =>
    ringNames.get(personId) ?? read.tables.people.get(personId)?.defaultRingName ?? personId;
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
      const nameOf = ringNamesOf(read, instance.promotionId);
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
          name: nameOf(personId),
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

export const SEGMENT_INJURIES_NOT_FOUND = "That show doesn't exist.";

export interface SegmentInjuriesArgs {
  readonly eventInstanceId: EventInstanceId;
}

const SegmentInjuriesArgsSchema = z.strictObject({ eventInstanceId: zId('eventInstance') });

/** One worker hurt in a match on the show, as WRK6's `injuries` row recorded it. */
export interface SegmentInjuryView {
  readonly injuryId: InjuryId;
  readonly segmentId: SegmentId;
  readonly personId: PersonId;
  /** Their ring name with the show's promotion. */
  readonly name: string;
  readonly bodyPart: BodyPart;
  /** The injury kind's name, such as "Sprained ankle"; the kind key when the catalog lacks it. */
  readonly kindLabel: string;
  /** The day they are expected back. */
  readonly expectedReturn: GameDate;
  /** `ceil((expectedReturn - show date) / 7)`, at least 1. */
  readonly weeksOut: number;
  /** The match's injury chance for them (`match.injuryChance`), while the store keeps it. */
  readonly chanceTraceRef: TraceRef | null;
  /** How long they are out (`health.injury`), while the store keeps it. */
  readonly injuryTraceRef: TraceRef | null;
}

export interface SegmentInjuriesResult {
  /** In card order (pre-show first, then by slot), then by person id. */
  readonly injuries: readonly SegmentInjuryView[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'match.segmentInjuries': {
      args: SegmentInjuriesArgs;
      result: SegmentInjuriesResult;
    };
  }
}

/** Days in a week, for "out about N weeks". */
const DAYS_IN_A_WEEK = 7;

/** "Out about N weeks": whole weeks rounded up, never less than one. */
export function weeksOutOf(showDate: GameDate, expectedReturn: GameDate): number {
  return Math.max(1, Math.ceil(diffDays(showDate, expectedReturn) / DAYS_IN_A_WEEK));
}

/**
 * `match.segmentInjuries { eventInstanceId }` (MTCH4-06): every worker hurt in a match on the show,
 * from WRK6's `injuries` rows with `source: 'segment'`, for the results page's injury banner. The
 * rows are kept for good; the two Why? refs are null once the store no longer has their traces.
 *
 * Viewer scoping: an injury on a rival's show is public news, so every viewer gets the same answer.
 */
export const segmentInjuriesQuery: QueryDefinition<'match.segmentInjuries'> = defineQuery(
  'match.segmentInjuries',
  {
    args: SegmentInjuriesArgsSchema,
    run: (ctx, args) => {
      const { read, traces } = ctx;
      const instance = read.tables.eventInstances.get(args.eventInstanceId);
      if (instance === undefined) {
        return refuseQuery({
          code: 'notFound',
          message: SEGMENT_INJURIES_NOT_FOUND,
          field: 'eventInstanceId',
        });
      }
      const nameOf = ringNamesOf(read, instance.promotionId);
      const segments = read.tables.segments
        .lookup('byEventInstance', instance.id)
        .filter((segment) => segment.kind === 'match')
        .sort(
          (left, right) => Number(right.preShow) - Number(left.preShow) || left.slot - right.slot,
        );
      const injuries: SegmentInjuryView[] = [];
      for (const segment of segments) {
        const competitors = read.tables.participants
          .lookup('bySegment', segment.id)
          .filter((participant) => participant.role === 'competitor')
          .map((participant) => participant.personId)
          .sort(compareIds);
        for (const personId of competitors) {
          const row = read.tables.injuries
            .lookup('byPerson', personId)
            .find((injury) => injury.source === 'segment' && injury.segmentId === segment.id);
          if (row === undefined) {
            continue;
          }
          const chanceRef = injuryChanceTraceRef(segment.id, personId);
          const outcomeRef = injuryTraceRef(row.id);
          injuries.push({
            injuryId: row.id,
            segmentId: segment.id,
            personId,
            name: nameOf(personId),
            bodyPart: row.bodyPart,
            kindLabel: injuryKindOf(read, row.kindKey)?.label ?? row.kindKey,
            expectedReturn: row.expectedReturn,
            weeksOut: weeksOutOf(instance.date, row.expectedReturn),
            chanceTraceRef: traces.has(chanceRef) ? chanceRef : null,
            injuryTraceRef: traces.has(outcomeRef) ? outcomeRef : null,
          });
        }
      }
      return { injuries };
    },
  },
);

export const physicalQueries: readonly QueryDefinition[] = [
  physicalForSegmentQuery,
  segmentInjuriesQuery,
];
