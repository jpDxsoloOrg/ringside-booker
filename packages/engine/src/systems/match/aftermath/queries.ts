/**
 * `match.aftermath` (MTCH3-03): the stored aftermaths of one match or of one whole show, for the
 * results page (MTCH3-05) and Recent form (MTCH3-04).
 *
 * Viewer scoping: results are public. A row holds only popularity and momentum, both on-screen
 * figures every viewer sees; nothing private (morale, contract terms) is stored in it, so every
 * viewer gets the same answer.
 *
 * Trace refs are given only while the trace is still in the recent-traces store; older results
 * keep their numbers but lose the full breakdown.
 *
 * Design: docs/design/match-aftermath.md#stored-aftermaths.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import type { GameDate } from '../../../core/date';
import type {
  AftermathId,
  EmploymentId,
  EventInstanceId,
  PersonId,
  RegionId,
  SegmentId,
} from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { Aftermath, AftermathOutcome } from '../../../model/entities/aftermath';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { momentumGainTraceRef, popularityGainTraceRef } from './apply';

export type AftermathQueryArgs = { segmentId: SegmentId } | { eventInstanceId: EventInstanceId };

const AftermathQueryArgsSchema = z.union([
  z.strictObject({ segmentId: zId('segment') }),
  z.strictObject({ eventInstanceId: zId('eventInstance') }),
]);

export const AFTERMATH_NOT_FOUND_MESSAGES = {
  segment: "That match doesn't exist.",
  eventInstance: "That show doesn't exist.",
} as const;

export interface AftermathRegionView {
  readonly regionId: RegionId;
  readonly name: string;
  readonly before: number;
  readonly after: number;
  readonly change: number;
}

export interface AftermathWorkerView {
  readonly aftermathId: AftermathId;
  readonly personId: PersonId;
  readonly name: string;
  readonly outcome: AftermathOutcome;
  readonly popularity: {
    /** The change the match asked for in the show's region, before the spread and taper. */
    readonly delta: number;
    /** The show region first, then the others most populous first. */
    readonly regions: readonly AftermathRegionView[];
    /** The `match.popularityGain` trace while it is kept; null once it has been pruned. */
    readonly traceRef: TraceRef | null;
  };
  /** Null when the worker had no contract with the show's promotion. */
  readonly momentum: {
    readonly employmentId: EmploymentId;
    /** Null when this match started the momentum. */
    readonly before: number | null;
    readonly after: number;
    /** `after − before`; null when this match started the momentum. */
    readonly change: number | null;
    readonly traceRef: TraceRef | null;
  } | null;
}

export interface AftermathSegmentView {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly eventName: string;
  readonly date: GameDate;
  readonly preShow: boolean;
  /** The stored 0-based slot in its section. */
  readonly slot: number;
  readonly showRegionId: RegionId;
  readonly showRegionName: string;
  /** By name, then person id. */
  readonly workers: readonly AftermathWorkerView[];
}

export interface AftermathResult {
  /** In card order: the pre-show first, then by slot. Matches with no stored rows are left out. */
  readonly segments: readonly AftermathSegmentView[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'match.aftermath': { args: AftermathQueryArgs; result: AftermathResult };
  }
}

function workerName(read: GameWorldView, row: DeepReadonly<Aftermath>): string {
  const employments = read.tables.employments
    .lookup('byPerson', row.personId)
    .filter((employment) => employment.promotionId === row.promotionId)
    .sort((left, right) => compareIds(right.id, left.id));
  return (
    employments[0]?.ringName ??
    read.tables.people.get(row.personId)?.defaultRingName ??
    row.personId
  );
}

function rowsOf(read: GameWorldView, args: AftermathQueryArgs): DeepReadonly<Aftermath>[] {
  const { aftermaths } = read.tables;
  if ('segmentId' in args) {
    if (!read.tables.segments.has(args.segmentId)) {
      return refuseQuery({
        code: 'notFound',
        message: AFTERMATH_NOT_FOUND_MESSAGES.segment,
        field: 'segmentId',
      });
    }
    return [...aftermaths.lookup('bySegment', args.segmentId)];
  }
  if (!read.tables.eventInstances.has(args.eventInstanceId)) {
    return refuseQuery({
      code: 'notFound',
      message: AFTERMATH_NOT_FOUND_MESSAGES.eventInstance,
      field: 'eventInstanceId',
    });
  }
  return [...aftermaths.lookup('byEventInstance', args.eventInstanceId)];
}

export const aftermathQuery: QueryDefinition<'match.aftermath'> = defineQuery('match.aftermath', {
  args: AftermathQueryArgsSchema,
  run: (ctx, args) => {
    const { read } = ctx;
    const kept = (ref: TraceRef): TraceRef | null => (ctx.traces.has(ref) ? ref : null);
    const bySegment = new Map<SegmentId, DeepReadonly<Aftermath>[]>();
    for (const row of rowsOf(read, args)) {
      bySegment.set(row.segmentId, [...(bySegment.get(row.segmentId) ?? []), row]);
    }
    const segments = [...bySegment.entries()].map(([segmentId, rows]): AftermathSegmentView => {
      const segment = read.tables.segments.require(segmentId);
      const instance = read.tables.eventInstances.require(segment.eventInstanceId);
      const showRegionId = rows[0]?.showRegionId ?? instance.regionId;
      const regionName = (regionId: RegionId): string =>
        read.tables.regions.get(regionId)?.name ?? regionId;
      const population = (regionId: RegionId): number =>
        read.tables.regions.get(regionId)?.population ?? 0;
      const workers = rows
        .map((row): AftermathWorkerView => {
          const regions: AftermathRegionView[] = [];
          for (const region of read.tables.regions.values()) {
            const values = row.popularity.byRegion[region.id];
            if (values !== undefined) {
              regions.push({
                regionId: region.id,
                name: region.name,
                before: values.before,
                after: values.after,
                change: values.after - values.before,
              });
            }
          }
          regions.sort(
            (left, right) =>
              Number(right.regionId === showRegionId) - Number(left.regionId === showRegionId) ||
              population(right.regionId) - population(left.regionId) ||
              compareIds(left.regionId, right.regionId),
          );
          return {
            aftermathId: row.id,
            personId: row.personId,
            name: workerName(read, row),
            outcome: row.outcome,
            popularity: {
              delta: row.popularity.delta,
              regions,
              traceRef: kept(popularityGainTraceRef(segmentId, row.personId)),
            },
            momentum:
              row.momentum === null
                ? null
                : {
                    employmentId: row.momentum.employmentId,
                    before: row.momentum.before,
                    after: row.momentum.after,
                    change:
                      row.momentum.before === null
                        ? null
                        : row.momentum.after - row.momentum.before,
                    traceRef: kept(momentumGainTraceRef(segmentId, row.personId)),
                  },
          };
        })
        .sort(
          (left, right) =>
            (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
            compareIds(left.personId, right.personId),
        );
      return {
        segmentId,
        eventInstanceId: instance.id,
        eventName: instance.name,
        date: instance.date,
        preShow: segment.preShow,
        slot: segment.slot,
        showRegionId,
        showRegionName: regionName(showRegionId),
        workers,
      };
    });
    segments.sort(
      (left, right) =>
        compareIds(left.eventInstanceId, right.eventInstanceId) ||
        Number(right.preShow) - Number(left.preShow) ||
        left.slot - right.slot,
    );
    return { segments };
  },
});

export const aftermathQueries: readonly QueryDefinition[] = [aftermathQuery];
