/**
 * The rival results' queries (AIP5-04):
 *
 * - `aip.segmentDecision { segmentId }`: the winner, method and reasons a computer booker planned
 *   for one match, hidden from other controllers until the show airs (the same reveal rule as the
 *   card, `isRevealedTo`);
 * - `aip.showDecisions { eventInstanceId }`: the same view for every match on one show, in running
 *   order (empty when no computer booker decided any), for the results page's "Booker's calls";
 * - `aip.recentTitleChanges { promotionId, limit }`: a promotion's latest title changes, newest
 *   first, with the booker's reason when a rival booker planned the change. Title changes are
 *   public, so there is no reveal check beyond the reign existing.
 *
 * See docs/design/engine-api.md and docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { compareDates, diffDays, type GameDate } from '../../../core/date';
import type { EventInstanceId, PromotionId, SegmentId, TitleId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { TitleReign } from '../../../model/entities/title-reign';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import { promotionOrRefuse } from '../queries/shared';
import { isRevealedTo } from '../reveal';
import { segmentDecisionView, titleDecisionOf, type SegmentDecisionView } from './view';

export const SEGMENT_NOT_FOUND = 'That match no longer exists.';
export const SHOW_NOT_FOUND = 'That show no longer exists.';
export const NOT_REVEALED_MESSAGE = "A rival's results are revealed when the show airs";
export const NO_DECISION_MESSAGE = 'No computer booker decided this result';
export const DEFAULT_TITLE_CHANGES_LIMIT = 5;
export const MAX_TITLE_CHANGES_LIMIT = 20;

export interface AipSegmentDecisionArgs {
  segmentId: SegmentId;
}

export interface AipShowDecisionsArgs {
  eventInstanceId: EventInstanceId;
}

export interface AipShowDecisions {
  /** One per match a computer booker decided, pre-show first, then the main card. */
  decisions: SegmentDecisionView[];
}

export interface AipRecentTitleChangesArgs {
  promotionId: PromotionId;
  /** 1 to 20; left out: 5. */
  limit?: number | undefined;
}

/** One title changing hands (or a vacant title filled). */
export interface AipTitleChange {
  titleId: TitleId;
  titleName: string;
  /** The new champions' names when they won it. */
  newHolderNames: string[];
  /** The previous champions' names when they lost it; empty when the title was vacant. */
  previousHolderNames: string[];
  wonOn: GameDate;
  eventInstanceId: EventInstanceId | null;
  showName: string | null;
  /** How long the previous reign lasted; null when the title was vacant. */
  previousReignDays: number | null;
  /** The rival booker's reason; null for your own shows and changes from before AIP5. */
  reasonText: string | null;
  traceRef: TraceRef | null;
}

export interface AipRecentTitleChanges {
  changes: AipTitleChange[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'aip.segmentDecision': { args: AipSegmentDecisionArgs; result: SegmentDecisionView };
    'aip.showDecisions': { args: AipShowDecisionsArgs; result: AipShowDecisions };
    'aip.recentTitleChanges': { args: AipRecentTitleChangesArgs; result: AipRecentTitleChanges };
  }
}

export const aipSegmentDecisionQuery: QueryDefinition<'aip.segmentDecision'> = defineQuery(
  'aip.segmentDecision',
  {
    args: z.strictObject({ segmentId: zId('segment') }),
    run: (ctx, args) => {
      const { read } = ctx;
      const segment = read.tables.segments.get(args.segmentId);
      const instance =
        segment === undefined ? undefined : read.tables.eventInstances.get(segment.eventInstanceId);
      if (segment === undefined || instance === undefined) {
        return refuseQuery({ code: 'notFound', message: SEGMENT_NOT_FOUND, field: 'segmentId' });
      }
      if (!isRevealedTo(read, ctx.viewer, instance.promotionId, instance.airDate)) {
        return refuseQuery({ code: 'notRevealed', message: NOT_REVEALED_MESSAGE });
      }
      const view = segmentDecisionView(read, ctx.traces, segment.id);
      if (view === null) {
        return refuseQuery({ code: 'noDecision', message: NO_DECISION_MESSAGE });
      }
      return view;
    },
  },
);

export const aipShowDecisionsQuery: QueryDefinition<'aip.showDecisions'> = defineQuery(
  'aip.showDecisions',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const { read } = ctx;
      const instance = read.tables.eventInstances.get(args.eventInstanceId);
      if (instance === undefined) {
        return refuseQuery({ code: 'notFound', message: SHOW_NOT_FOUND, field: 'eventInstanceId' });
      }
      if (!isRevealedTo(read, ctx.viewer, instance.promotionId, instance.airDate)) {
        return refuseQuery({ code: 'notRevealed', message: NOT_REVEALED_MESSAGE });
      }
      const decisions = cardSegments(read, instance.id).flatMap((segment) => {
        const view = segmentDecisionView(read, ctx.traces, segment.id);
        return view === null ? [] : [view];
      });
      return { decisions };
    },
  },
);

/** The reign that ended in the match `reign` was won in, if any. */
function previousReignOf(
  reigns: readonly DeepReadonly<TitleReign>[],
  reign: DeepReadonly<TitleReign>,
): DeepReadonly<TitleReign> | null {
  if (reign.wonInSegmentId === null) {
    return null;
  }
  return reigns.find((other) => other.endedInSegmentId === reign.wonInSegmentId) ?? null;
}

export const aipRecentTitleChangesQuery: QueryDefinition<'aip.recentTitleChanges'> = defineQuery(
  'aip.recentTitleChanges',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      limit: z.number().int().min(1).max(MAX_TITLE_CHANGES_LIMIT).optional(),
    }),
    run: (ctx, args) => {
      const { read } = ctx;
      const promotion = promotionOrRefuse(read, args.promotionId);
      const limit = args.limit ?? DEFAULT_TITLE_CHANGES_LIMIT;
      const found: { reign: DeepReadonly<TitleReign>; change: () => AipTitleChange }[] = [];
      for (const title of read.tables.titles.lookup('byPromotion', promotion.id)) {
        const reigns = read.tables.titleReigns.lookup('byTitle', title.id);
        for (const reign of reigns) {
          if (reign.wonInSegmentId === null) {
            continue;
          }
          const segmentId = reign.wonInSegmentId;
          found.push({
            reign,
            change: () => {
              const previous = previousReignOf(reigns, reign);
              const segment = read.tables.segments.get(segmentId);
              const instance =
                segment === undefined
                  ? undefined
                  : read.tables.eventInstances.get(segment.eventInstanceId);
              const row =
                instance === undefined
                  ? null
                  : titleDecisionOf(read, instance, segmentId, title.id);
              return {
                titleId: title.id,
                titleName: title.name,
                newHolderNames: [...reign.holderNamesAtTime],
                previousHolderNames: previous === null ? [] : [...previous.holderNamesAtTime],
                wonOn: reign.wonOn,
                eventInstanceId: instance?.id ?? null,
                showName: instance?.name ?? null,
                previousReignDays:
                  previous?.lostOn === null || previous === null
                    ? null
                    : diffDays(previous.wonOn, previous.lostOn),
                reasonText: row === null ? null : String(row.summary.params['reason'] ?? ''),
                traceRef:
                  row?.traceRef !== null &&
                  row?.traceRef !== undefined &&
                  ctx.traces.has(row.traceRef)
                    ? { ...row.traceRef }
                    : null,
              };
            },
          });
        }
      }
      found.sort(
        (left, right) =>
          compareDates(right.reign.wonOn, left.reign.wonOn) ||
          compareIds(right.reign.id, left.reign.id),
      );
      return { changes: found.slice(0, limit).map((entry) => entry.change()) };
    },
  },
);
