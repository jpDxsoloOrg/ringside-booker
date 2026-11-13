/**
 * `match.recentForm` (MTCH3-04): a worker's last few run matches, newest first, with what each did
 * to their popularity in the show's region and to their momentum. The worker profile's Form tab
 * reads it.
 *
 * The matches come from `priorMatchesOf` (everything up to and including today); the changes come
 * from the worker's stored `aftermaths` row. A match whose row was pruned, or never written (a no
 * contest writes none), has null changes. Trace refs are given only while the trace is still in
 * the recent-traces store.
 *
 * Viewer scoping: results are public, and a row holds no morale or contract terms, so every viewer
 * gets the same answer.
 *
 * Design: docs/design/match-aftermath.md#recent-form.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import type { ContentKey } from '../../../core/content-key';
import { addDays, type GameDate } from '../../../core/date';
import type { EventInstanceId, PersonId, PromotionId, SegmentId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import { aftermathSegmentPersonKey } from '../../../model/entities/aftermath';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import { momentumGainTraceRef, popularityGainTraceRef } from './apply';
import { priorMatchesOf, type MatchResultForSide } from './history';

/** How many matches `match.recentForm` gives when no limit is asked for. */
export const RECENT_FORM_DEFAULT_LIMIT = 5;
/** The most matches `match.recentForm` gives. */
export const RECENT_FORM_MAX_LIMIT = 10;

export const RECENT_FORM_NOT_FOUND_MESSAGE = "That person doesn't exist.";

export interface RecentFormArgs {
  readonly personId: PersonId;
  /** 1..10; 5 when left out. */
  readonly limit?: number | undefined;
}

const RecentFormArgsSchema = z.strictObject({
  personId: zId('person'),
  limit: z.number().int().min(1).max(RECENT_FORM_MAX_LIMIT).optional(),
});

export interface RecentFormOpponent {
  readonly personId: PersonId;
  readonly name: string;
}

export interface RecentFormRow {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly date: GameDate;
  readonly eventName: string;
  readonly promotionId: PromotionId;
  readonly result: MatchResultForSide;
  /** The competitors on every other side, by name. */
  readonly opponents: readonly RecentFormOpponent[];
  /** The win method, for a match with a winner. */
  readonly methodKey: ContentKey | null;
  /** The finish the match was booked with, when one was chosen. */
  readonly finishKey: ContentKey | null;
  /** The stored change in the show's region; null when the row was pruned or never written. */
  readonly popularityChange: number | null;
  /** The stored momentum change; null without a row, a contract, or a momentum before the match. */
  readonly momentumChange: number | null;
  readonly traceRefs: {
    readonly popularity: TraceRef | null;
    readonly momentum: TraceRef | null;
  };
}

export interface RecentFormResult {
  /** Newest first. */
  readonly matches: readonly RecentFormRow[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'match.recentForm': { args: RecentFormArgs; result: RecentFormResult };
  }
}

/** The name a person goes by with `promotionId`: their newest ring name there, else their own. */
function nameWith(read: GameWorldView, personId: PersonId, promotionId: PromotionId): string {
  const employments = read.tables.employments
    .lookup('byPerson', personId)
    .filter((employment) => employment.promotionId === promotionId)
    .sort((left, right) => compareIds(right.id, left.id));
  return employments[0]?.ringName ?? read.tables.people.get(personId)?.defaultRingName ?? personId;
}

/** `after − before`, or null when the match started the momentum. */
function momentumChangeOf({
  before,
  after,
}: {
  before: number | null;
  after: number;
}): number | null {
  return before === null ? null : after - before;
}

export const recentFormQuery: QueryDefinition<'match.recentForm'> = defineQuery(
  'match.recentForm',
  {
    args: RecentFormArgsSchema,
    run: (ctx, args) => {
      const { read } = ctx;
      if (!read.tables.people.has(args.personId)) {
        return refuseQuery({
          code: 'notFound',
          message: RECENT_FORM_NOT_FOUND_MESSAGE,
          field: 'personId',
        });
      }
      const kept = (ref: TraceRef): TraceRef | null => (ctx.traces.has(ref) ? ref : null);
      // Tomorrow, on no show: every match up to and including today counts.
      const prior = priorMatchesOf(
        read,
        args.personId,
        {
          date: addDays(ctx.date, 1),
          eventInstanceId: null,
          preShow: false,
          slot: 0,
          segmentId: null,
        },
        args.limit ?? RECENT_FORM_DEFAULT_LIMIT,
      );
      const matches = prior.map((match): RecentFormRow => {
        const segment = read.tables.segments.require(match.segmentId);
        const instance = read.tables.eventInstances.require(match.eventInstanceId);
        const row = read.tables.aftermaths
          .lookup('bySegmentPerson', aftermathSegmentPersonKey(match.segmentId, args.personId))
          .at(0);
        const shown = row?.popularity.byRegion[row.showRegionId];
        const momentum = row?.momentum ?? null;
        return {
          segmentId: match.segmentId,
          eventInstanceId: instance.id,
          date: match.date,
          eventName: instance.name,
          promotionId: instance.promotionId,
          result: match.result,
          opponents: match.opponentIds.map((personId) => ({
            personId,
            name: nameWith(read, personId, instance.promotionId),
          })),
          methodKey:
            segment.kind === 'match' && segment.outcome?.kind === 'win'
              ? segment.outcome.methodKey
              : null,
          finishKey: segment.kind === 'match' ? segment.match.finishKey : null,
          popularityChange: shown === undefined ? null : shown.after - shown.before,
          momentumChange: momentum === null ? null : momentumChangeOf(momentum),
          traceRefs: {
            popularity:
              row === undefined
                ? null
                : kept(popularityGainTraceRef(match.segmentId, args.personId)),
            momentum:
              momentum === null ? null : kept(momentumGainTraceRef(match.segmentId, args.personId)),
          },
        };
      });
      return { matches };
    },
  },
);

export const recentFormQueries: readonly QueryDefinition[] = [recentFormQuery];
