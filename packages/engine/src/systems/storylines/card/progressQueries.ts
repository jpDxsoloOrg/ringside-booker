/**
 * What the heat step left behind (CRTV4-02), for the show results page and the storyline's
 * timeline (both drawn by CRTV4-05):
 *
 * - `storylines.showProgress { eventInstanceId }`: per linked segment of one show, how each
 *   storyline's heat moved, which links did not count and why, and the losers a counted storyline
 *   covers (the story shield's chip anchors).
 * - `storylines.timeline { storylineId }`: a storyline's progress rows, newest first, joined to
 *   their show and segment.
 *
 * Both are for the viewer's own promotion only: a rival's heat stays private (CRTV3). Rows only go
 * back as far as the progress log does (`history.keepDetailDays`); older segments live on in the
 * storyline's `progressTotals`.
 *
 * Design: docs/design/storylines.md#heat-after-segment.
 */

import { z } from 'zod';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../../core/api/query';
import type { Reason } from '../../../core/api/result';
import type { GameDate } from '../../../core/date';
import type { EventInstanceId, PersonId, SegmentId, StorylineId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { ShowFormat } from '../../../model/entities/event-definition';
import type { Segment, SegmentKind } from '../../../model/entities/segment';
import type {
  Storyline,
  StorylineProgress,
  StorylineProgressTotals,
} from '../../../model/entities/storyline';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import { viewerControlsShow } from '../../calendar/control';
import { isPastDetailWindow } from '../../history/note';
import { traceRefFromKey } from '../../shows/traces';
import { segmentLabel } from '../queries';
import { editsStorylinesOf } from '../rows';
import { membersInSegment } from './membersInSegment';

export const STORYLINE_PROGRESS_REASONS = {
  showNotFound: 'storylines.showNotFound',
  notYourShow: 'notYourShow',
  storylineNotFound: 'storylines.notFound',
  notYours: 'storylines.notYours',
} as const;

export const NOT_COUNTED_ENDED = 'The storyline had ended';
export const NOT_COUNTED_NO_MEMBER = 'Nobody in this segment is in the storyline';

/** One storyline a segment moved. */
export interface StorylineShowProgressRow {
  storylineId: StorylineId;
  name: string;
  heatBefore: number;
  heatAfter: number;
  /** The heat step's Why? (full or summary), or null when none was kept. */
  traceRef: TraceRef | null;
  finale: boolean;
}

/** A linked storyline the segment did not count for, and why in words. */
export interface StorylineNotCountedRow {
  storylineId: StorylineId;
  name: string;
  reason: string;
}

/** One linked segment of the show. */
export interface StorylineShowProgressSegment {
  segmentId: SegmentId;
  slot: number;
  preShow: boolean;
  rows: StorylineShowProgressRow[];
  /** Filled once the segment has been run: before that nothing has counted yet. */
  notCounted: StorylineNotCountedRow[];
  /** Losers of the match who are members of a storyline it counted for (story shield anchors). */
  protectedLosers: { personId: PersonId; storylineId: StorylineId }[];
}

export type StorylineShowProgress =
  | {
      kind: 'ok';
      segments: StorylineShowProgressSegment[];
      /**
       * True when the show is older than the detail window (`history.keepDetailDays`): its
       * progress rows may have gone, so `rows` can be empty and `notCounted` always is.
       */
      pastDetailWindow: boolean;
    }
  | { kind: 'unavailable'; reason: Reason };

/** One row of a storyline's timeline. Segment fields are null when the segment is gone. */
export interface StorylineTimelineRow {
  segmentId: SegmentId;
  eventInstanceId: EventInstanceId;
  /** Null when the show is gone. */
  showName: string | null;
  date: GameDate;
  /** For the slot role label: the stored slot, pre-show flag and the show's format. */
  slot: number | null;
  preShow: boolean | null;
  format: ShowFormat | null;
  kind: SegmentKind | null;
  /** "Ise vs Kuroe", or null when the segment is gone. */
  segmentLabel: string | null;
  heatBefore: number;
  heatAfter: number;
  traceRef: TraceRef | null;
  finale: boolean;
}

export type StorylineTimeline =
  | {
      kind: 'ok';
      /** Newest first, within the detail window. */
      rows: StorylineTimelineRow[];
      /** All-time totals, including rows the window has dropped. */
      totals: StorylineProgressTotals;
      /** `history.keepDetailDays`: how far back `rows` go. */
      keptDays: number;
    }
  | { kind: 'unavailable'; reason: Reason };

declare module '../../../core/api/maps' {
  interface QueryMap {
    'storylines.showProgress': {
      args: { eventInstanceId: EventInstanceId };
      result: StorylineShowProgress;
    };
    'storylines.timeline': { args: { storylineId: StorylineId }; result: StorylineTimeline };
  }
}

function keptTraceRef(ctx: QueryContext, traceId: string | null): TraceRef | null {
  const ref = traceId === null ? null : traceRefFromKey(traceId);
  return ref !== null && ctx.traces.has(ref) ? ref : null;
}

function wasRun(segment: DeepReadonly<Segment>, showCompleted: boolean): boolean {
  return segment.rating !== null || showCompleted;
}

/** The match's losers: competitors not on the winning side. Empty for a draw, no contest or angle. */
function losersOf(ctx: QueryContext, segment: DeepReadonly<Segment>): Set<PersonId> {
  const losers = new Set<PersonId>();
  if (segment.kind !== 'match' || segment.outcome?.kind !== 'win') {
    return losers;
  }
  const winningSide = segment.outcome.winningSide;
  for (const participant of ctx.read.tables.participants.lookup('bySegment', segment.id)) {
    if (participant.role === 'competitor' && participant.side !== winningSide) {
      losers.add(participant.personId);
    }
  }
  return losers;
}

export const storylinesShowProgressQuery: QueryDefinition<'storylines.showProgress'> = defineQuery(
  'storylines.showProgress',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args): StorylineShowProgress => {
      const { read } = ctx;
      const show = read.tables.eventInstances.get(args.eventInstanceId);
      if (show === undefined) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PROGRESS_REASONS.showNotFound,
            message: "That show doesn't exist any more.",
            subject: { kind: 'eventInstance', id: args.eventInstanceId },
          },
        };
      }
      if (!viewerControlsShow(read, show, ctx.viewer)) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PROGRESS_REASONS.notYourShow,
            message: `${show.name} isn't one of your shows`,
            subject: { kind: 'eventInstance', id: show.id },
          },
        };
      }
      const showCompleted = show.status === 'completed';
      const pastDetailWindow = isPastDetailWindow(
        show.date,
        ctx.date,
        ctx.tunables.get('history.keepDetailDays'),
      );
      const segments: StorylineShowProgressSegment[] = [];
      for (const segment of cardSegments(read, show.id)) {
        if (segment.storylineIds.length === 0) {
          continue;
        }
        const run = wasRun(segment, showCompleted) && !pastDetailWindow;
        const losers = losersOf(ctx, segment);
        const rows: StorylineShowProgressRow[] = [];
        const notCounted: StorylineNotCountedRow[] = [];
        const protectedLosers: StorylineShowProgressSegment['protectedLosers'] = [];
        for (const storylineId of [...segment.storylineIds].sort(compareIds)) {
          const storyline = read.tables.storylines.get(storylineId);
          if (storyline === undefined) {
            continue;
          }
          const row = storyline.progress.find((entry) => entry.segmentId === segment.id);
          if (row === undefined) {
            if (run) {
              const reason =
                membersInSegment(read, storyline.id, segment.id).length === 0
                  ? NOT_COUNTED_NO_MEMBER
                  : NOT_COUNTED_ENDED;
              notCounted.push({ storylineId: storyline.id, name: storyline.name, reason });
            }
            continue;
          }
          rows.push({
            storylineId: storyline.id,
            name: storyline.name,
            heatBefore: row.heatBefore,
            heatAfter: row.heatAfter,
            traceRef: keptTraceRef(ctx, row.traceId),
            finale: storyline.finaleSegmentId === segment.id,
          });
          for (const member of storyline.members) {
            if (losers.has(member.personId)) {
              protectedLosers.push({ personId: member.personId, storylineId: storyline.id });
            }
          }
        }
        protectedLosers.sort(
          (left, right) =>
            compareIds(left.personId, right.personId) ||
            compareIds(left.storylineId, right.storylineId),
        );
        segments.push({
          segmentId: segment.id,
          slot: segment.slot,
          preShow: segment.preShow,
          rows,
          notCounted,
          protectedLosers,
        });
      }
      return { kind: 'ok', segments, pastDetailWindow };
    },
  },
);

function timelineRow(
  ctx: QueryContext,
  storyline: DeepReadonly<Storyline>,
  entry: DeepReadonly<StorylineProgress>,
): StorylineTimelineRow {
  const show = ctx.read.tables.eventInstances.get(entry.eventInstanceId);
  const segment = ctx.read.tables.segments.get(entry.segmentId);
  return {
    segmentId: entry.segmentId,
    eventInstanceId: entry.eventInstanceId,
    showName: show?.name ?? null,
    date: entry.date,
    slot: segment?.slot ?? null,
    preShow: segment?.preShow ?? null,
    format: show === undefined ? null : { ...show.format },
    kind: segment?.kind ?? null,
    segmentLabel: segment === undefined ? null : segmentLabel(ctx, segment, storyline.promotionId),
    heatBefore: entry.heatBefore,
    heatAfter: entry.heatAfter,
    traceRef: keptTraceRef(ctx, entry.traceId),
    finale: storyline.finaleSegmentId === entry.segmentId,
  };
}

export const storylinesTimelineQuery: QueryDefinition<'storylines.timeline'> = defineQuery(
  'storylines.timeline',
  {
    args: z.strictObject({ storylineId: zId('storyline') }),
    run: (ctx, args): StorylineTimeline => {
      const storyline = ctx.read.tables.storylines.get(args.storylineId);
      if (storyline === undefined) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PROGRESS_REASONS.storylineNotFound,
            message: "That storyline doesn't exist any more.",
            subject: { kind: 'storyline', id: args.storylineId },
          },
        };
      }
      if (!editsStorylinesOf(ctx.read, ctx.viewer, storyline.promotionId)) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PROGRESS_REASONS.notYours,
            message: `'${storyline.name}' isn't one of your storylines`,
            subject: { kind: 'storyline', id: storyline.id },
          },
        };
      }
      const rows = storyline.progress.map((entry) => timelineRow(ctx, storyline, entry)).reverse();
      return {
        kind: 'ok',
        rows,
        totals: { ...storyline.progressTotals },
        keptDays: ctx.tunables.get('history.keepDetailDays'),
      };
    },
  },
);

export const storylinesProgressQueries = [
  storylinesShowProgressQuery,
  storylinesTimelineQuery,
] as const;
