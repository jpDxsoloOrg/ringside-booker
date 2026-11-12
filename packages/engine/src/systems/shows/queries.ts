/**
 * The shows system's queries: show night's results, ready for a screen.
 *
 * - `shows.results`: one show's results page (header, score, every segment with its result and
 *   the titles it settled). See `resultsView.ts` for what each viewer may see.
 * - `shows.lastCompleted`: the latest completed show, as one line (the Office "Last show" panel,
 *   the Next Day summary).
 * - `shows.completedSince`: the shows completed in a date range, newest first (the "See results"
 *   links after an advance).
 *
 * Design notes: docs/design/show-night.md#results-queries.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import { addDays, compareDates, diffDays, type GameDate } from '../../core/date';
import type { EventInstanceId } from '../../core/ids';
import { MAX_ADVANCE_DAYS } from '../../core/pipeline/advance';
import type { EventInstance } from '../../model/entities/event-instance';
import { zGameDate, zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import {
  isViewerShow,
  showResultsView,
  showSummaryView,
  type ResultsViewDeps,
  type ShowResultsView,
  type ShowSummaryView,
} from './resultsView';

/** Whose shows a results query lists: the viewer's own, or every promotion's. */
export const RESULTS_SCOPES = ['mine', 'world'] as const;
export type ResultsScope = (typeof RESULTS_SCOPES)[number];

/** The longest range `shows.completedSince` reads, in days: the most one advance can skip. */
export const MAX_RESULTS_RANGE_DAYS = MAX_ADVANCE_DAYS;
/** The most shows `shows.completedSince` returns, and how many it returns when not told. */
export const MAX_COMPLETED_SINCE = 50;
export const DEFAULT_COMPLETED_SINCE = 10;

/** What the player reads when a show id is unknown. */
export const SHOW_NOT_FOUND_MESSAGE = "That show doesn't exist.";

/** What the player reads when a range is refused. */
export const RESULTS_RANGE_MESSAGES = {
  backwards: 'A results range cannot end before it starts.',
  tooLong: `A results range can cover at most ${String(MAX_RESULTS_RANGE_DAYS)} days.`,
} as const;

/** What `shows.completedSince` takes. */
export interface CompletedSinceArgs {
  /** The first day, included. */
  from: GameDate;
  /** The day after the last one: shows on `to` are not included. */
  to: GameDate;
  scope: ResultsScope;
  /** 1 to {@link MAX_COMPLETED_SINCE}; {@link DEFAULT_COMPLETED_SINCE} when left out. */
  limit?: number | undefined;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'shows.results': {
      args: { eventInstanceId: EventInstanceId };
      result: ShowResultsView | null;
    };
    'shows.lastCompleted': {
      args: { scope?: ResultsScope | undefined };
      result: ShowSummaryView | null;
    };
    'shows.completedSince': { args: CompletedSinceArgs; result: ShowSummaryView[] };
  }
}

function depsOf(ctx: QueryContext): ResultsViewDeps {
  return { viewer: ctx.viewer, tunables: ctx.tunables, traces: ctx.traces };
}

/**
 * The scope a viewer really gets: `mine` needs a viewer who runs a promotion, so the omniscient
 * viewer and a player without one read the whole world.
 */
function effectiveScope(ctx: QueryContext, scope: ResultsScope): ResultsScope {
  return scope === 'mine' && viewerPromotionIds(ctx.read, ctx.viewer).length === 0
    ? 'world'
    : scope;
}

/** The completed shows dated `date` that the scope keeps, newest first (highest id first). */
function completedOn(
  ctx: QueryContext,
  date: GameDate,
  scope: ResultsScope,
): DeepReadonly<EventInstance>[] {
  return ctx.read.tables.eventInstances
    .lookup('byDate', date)
    .filter(
      (instance) =>
        instance.status === 'completed' &&
        (scope === 'world' || isViewerShow(ctx.read, instance, ctx.viewer)),
    )
    .sort((left, right) => compareIds(right.id, left.id));
}

export const resultsQuery: QueryDefinition<'shows.results'> = defineQuery('shows.results', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  run: (ctx, args) => {
    const instance = ctx.read.tables.eventInstances.get(args.eventInstanceId);
    if (instance === undefined) {
      return refuseQuery({ code: 'notFound', message: SHOW_NOT_FOUND_MESSAGE });
    }
    return showResultsView(ctx.read, instance, depsOf(ctx));
  },
});

export const lastCompletedQuery: QueryDefinition<'shows.lastCompleted'> = defineQuery(
  'shows.lastCompleted',
  {
    args: z.strictObject({ scope: z.enum(RESULTS_SCOPES).optional() }),
    run: (ctx, args) => {
      const scope = effectiveScope(ctx, args.scope ?? 'mine');
      // Walk back a day at a time through the date index: the latest show is nearly always a day
      // or two back, and the walk stops at the world's first day or the skip limit.
      const start = ctx.read.meta.startDate;
      const days = Math.min(diffDays(start, ctx.date), MAX_RESULTS_RANGE_DAYS);
      for (let back = 0; back <= days; back++) {
        const [latest] = completedOn(ctx, addDays(ctx.date, -back), scope);
        if (latest !== undefined) {
          return showSummaryView(ctx.read, latest, depsOf(ctx));
        }
      }
      return null;
    },
  },
);

export const completedSinceQuery: QueryDefinition<'shows.completedSince'> = defineQuery(
  'shows.completedSince',
  {
    args: z
      .strictObject({
        from: zGameDate,
        to: zGameDate,
        scope: z.enum(RESULTS_SCOPES),
        limit: z.number().int().min(1).max(MAX_COMPLETED_SINCE).optional(),
      })
      .refine((args) => compareDates(args.to, args.from) >= 0, {
        message: RESULTS_RANGE_MESSAGES.backwards,
        path: ['to'],
      })
      .refine((args) => diffDays(args.from, args.to) <= MAX_RESULTS_RANGE_DAYS, {
        message: RESULTS_RANGE_MESSAGES.tooLong,
        path: ['to'],
      }),
    run: (ctx, args) => {
      const scope = effectiveScope(ctx, args.scope);
      const limit = args.limit ?? DEFAULT_COMPLETED_SINCE;
      const found: DeepReadonly<EventInstance>[] = [];
      // Newest first: from the day before `to` back to `from`.
      for (let back = 1; back <= diffDays(args.from, args.to) && found.length < limit; back++) {
        found.push(...completedOn(ctx, addDays(args.to, -back), scope));
      }
      const deps = depsOf(ctx);
      return found.slice(0, limit).map((instance) => showSummaryView(ctx.read, instance, deps));
    },
  },
);

export const showsQueries: readonly QueryDefinition[] = [
  resultsQuery,
  lastCompletedQuery,
  completedSinceQuery,
];
