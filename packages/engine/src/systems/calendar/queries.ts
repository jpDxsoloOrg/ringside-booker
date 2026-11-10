/**
 * The calendar's queries: what a screen reads to show the schedule.
 *
 * - `calendar.range`: the stored shows between two dates.
 * - `calendar.projected`: the shows the definitions would have past the stored horizon. They are
 *   worked out on read and never stored.
 * - `calendar.show`: one stored show, with why it is held where it is and how often it runs.
 * - `calendar.nextShow`: the first open show from today on.
 *
 * Schedules are public, so every viewer can read every promotion's shows. The `mine` scope keeps
 * the shows the viewing player runs. No row carries money.
 *
 * Design notes: docs/design/calendar.md#queries.
 */

import { z } from 'zod';
import type { Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { compareDates, diffDays, type GameDate } from '../../core/date';
import type { BrandId, EventInstanceId, PromotionId } from '../../core/ids';
import { EVENT_IMPORTANCES } from '../../model/entities/event-definition';
import { definitionAirDateKey, type EventInstance } from '../../model/entities/event-instance';
import { zGameDate, zId } from '../../model/primitives';
import type { DeepReadonly } from '../../model/world';
import type { ShowOwnership } from './control';
import { placeShow } from './placement';
import { recurrenceText } from './recurrenceText';
import { addDaysWithinCalendar, isSchedulable, occurrencesBetween } from './schedule';
import {
  calendarRowBuilder,
  viewerOwnsShow,
  type CalendarShow,
  type CalendarShowDetail,
} from './view';

/** Whose shows a calendar query returns: the viewing player's own, or every promotion's. */
export const CALENDAR_SCOPES = ['mine', 'world'] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

/** What `calendar.range` and `calendar.projected` take. */
export interface CalendarWindowArgs {
  /** The first day, included. */
  from: GameDate;
  /** The last day, included. At most {@link MAX_CALENDAR_RANGE_DAYS} days after `from`. */
  to: GameDate;
  scope: CalendarScope;
  /** Keeps one promotion's shows. */
  promotionId?: PromotionId | undefined;
  /** Keeps one brand's shows. */
  brandId?: BrandId | undefined;
}

/** `calendar.range`: the stored shows in the window. */
export interface CalendarRangeView {
  today: GameDate;
  /** The last day shows are stored for: today plus `calendar.scheduleHorizonDays`. */
  horizonEnd: GameDate;
  shows: CalendarShow[];
}

/** `calendar.projected`: the shows past the horizon that are not stored yet. */
export interface CalendarProjectedView {
  today: GameDate;
  /** The last day the projection reaches: today plus `calendar.projectionMaxDays`. */
  projectionEnd: GameDate;
  shows: CalendarShow[];
}

/** `calendar.nextShow`: the next open show and how many days away it is (0 for today). */
export interface NextShowView {
  show: CalendarShow;
  daysUntil: number;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'calendar.range': { args: CalendarWindowArgs; result: CalendarRangeView };
    'calendar.projected': { args: CalendarWindowArgs; result: CalendarProjectedView };
    'calendar.show': {
      args: { eventInstanceId: EventInstanceId };
      result: CalendarShowDetail | null;
    };
    'calendar.nextShow': {
      args: { scope?: CalendarScope | undefined };
      result: NextShowView | null;
    };
  }
}

/**
 * The longest window one calendar query covers, as `to - from` in days. A year view is the widest
 * thing a screen asks for, and 366 lets it span a leap year. Without a cap one call could walk
 * every day of the game's eleven centuries.
 */
export const MAX_CALENDAR_RANGE_DAYS = 366;

/** What the player reads when a window is refused. */
export const CALENDAR_RANGE_MESSAGES = {
  tooLong: `A calendar range can cover at most ${String(MAX_CALENDAR_RANGE_DAYS)} days.`,
  backwards: 'A calendar range cannot end before it starts.',
} as const;

// A query has no rules step: the only way it can refuse is through its arguments. Both refusals
// are reported on `to`, the end the player would move to fix either.
const zCalendarWindow = z
  .strictObject({
    from: zGameDate,
    to: zGameDate,
    scope: z.enum(CALENDAR_SCOPES),
    promotionId: zId('promotion').optional(),
    brandId: zId('brand').optional(),
  })
  .refine((args) => compareDates(args.to, args.from) >= 0, {
    message: CALENDAR_RANGE_MESSAGES.backwards,
    path: ['to'],
  })
  .refine((args) => diffDays(args.from, args.to) <= MAX_CALENDAR_RANGE_DAYS, {
    message: CALENDAR_RANGE_MESSAGES.tooLong,
    path: ['to'],
  });

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function earlierOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) <= 0 ? left : right;
}

/** Flagship first, house shows last. */
function importanceRank(show: Pick<CalendarShow, 'importance'>): number {
  return -EVENT_IMPORTANCES.indexOf(show.importance);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The calendar's order: by date, then importance (flagship first), then promotion name, then the
 * row's key. The key is unique, so the order is total and never depends on how rows were found.
 */
export function compareCalendarShows(left: CalendarShow, right: CalendarShow): number {
  return (
    compareDates(left.date, right.date) ||
    importanceRank(left) - importanceRank(right) ||
    compareText(left.promotion.name, right.promotion.name) ||
    compareText(left.key, right.key)
  );
}

/** True when a show passes the window's scope and its promotion and brand filters. */
function isWanted(
  ctx: QueryContext,
  show: ShowOwnership,
  filter: {
    readonly scope: CalendarScope;
    readonly promotionId?: PromotionId | undefined;
    readonly brandId?: BrandId | undefined;
  },
): boolean {
  if (filter.promotionId !== undefined && show.promotionId !== filter.promotionId) {
    return false;
  }
  if (filter.brandId !== undefined && show.brandId !== filter.brandId) {
    return false;
  }
  return filter.scope === 'world' || viewerOwnsShow(ctx.read, show, ctx.viewer);
}

/** True when `mine` can hold anything for this viewer: only a human player has shows of their own. */
function canOwnShows(viewer: DeepReadonly<Viewer>): boolean {
  return viewer.kind === 'controller' && viewer.controller.kind === 'human';
}

function horizonEndOf(ctx: QueryContext): GameDate {
  return addDaysWithinCalendar(ctx.date, ctx.tunables.get('calendar.scheduleHorizonDays'));
}

export const rangeQuery: QueryDefinition<'calendar.range'> = defineQuery('calendar.range', {
  args: zCalendarWindow,
  run: (ctx, args) => {
    const view: CalendarRangeView = { today: ctx.date, horizonEnd: horizonEndOf(ctx), shows: [] };
    if (args.scope === 'mine' && !canOwnShows(ctx.viewer)) {
      return view;
    }
    const rows = calendarRowBuilder(ctx.read, ctx.viewer, ctx.date);
    const dayCount = diffDays(args.from, args.to);
    for (let dayIndex = 0; dayIndex <= dayCount; dayIndex += 1) {
      const day = addDaysWithinCalendar(args.from, dayIndex);
      for (const instance of ctx.read.tables.eventInstances.lookup('byDate', day)) {
        if (isWanted(ctx, instance, args)) {
          view.shows.push(rows.stored(instance));
        }
      }
    }
    view.shows.sort(compareCalendarShows);
    return view;
  },
});

export const projectedQuery: QueryDefinition<'calendar.projected'> = defineQuery(
  'calendar.projected',
  {
    args: zCalendarWindow,
    run: (ctx, args) => {
      const projectionEnd = addDaysWithinCalendar(
        ctx.date,
        ctx.tunables.get('calendar.projectionMaxDays'),
      );
      const view: CalendarProjectedView = { today: ctx.date, projectionEnd, shows: [] };
      if (args.scope === 'mine' && !canOwnShows(ctx.viewer)) {
        return view;
      }
      const horizonEnd = horizonEndOf(ctx);
      const firstProjectedDay = addDaysWithinCalendar(horizonEnd, 1);
      if (firstProjectedDay === horizonEnd) {
        // The horizon already reaches the last supported game date.
        return view;
      }
      const from = laterOf(args.from, firstProjectedDay);
      const to = earlierOf(args.to, projectionEnd);
      if (compareDates(from, to) > 0) {
        return view;
      }
      const rows = calendarRowBuilder(ctx.read, ctx.viewer, ctx.date);
      for (const definition of ctx.read.tables.eventDefinitions.values()) {
        if (!isWanted(ctx, definition, args) || !isSchedulable(ctx.read, definition)) {
          continue;
        }
        for (const occurrence of occurrencesBetween(definition, from, to)) {
          const stored = ctx.read.tables.eventInstances.lookupOne(
            'byDefinitionAirDate',
            definitionAirDateKey(definition.id, occurrence),
          );
          if (stored === undefined) {
            view.shows.push(rows.projected(definition, occurrence));
          }
        }
      }
      view.shows.sort(compareCalendarShows);
      return view;
    },
  },
);

/**
 * The placement rule's reasoning for a stored show, while the show is still where the rule puts
 * it. Once anything else has set the venue or the region, the rule no longer explains them.
 */
function placementTraceOf(
  ctx: QueryContext,
  instance: DeepReadonly<EventInstance>,
): CalendarShowDetail['placementTrace'] {
  const definition =
    instance.eventDefinitionId === null
      ? undefined
      : ctx.read.tables.eventDefinitions.get(instance.eventDefinitionId);
  if (definition === undefined) {
    return null;
  }
  const placement = placeShow(ctx.read, definition, instance.date);
  const unchanged =
    placement.value.venueId === instance.venueId && placement.value.regionId === instance.regionId;
  return unchanged ? placement.trace : null;
}

export const showQuery: QueryDefinition<'calendar.show'> = defineQuery('calendar.show', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  run: (ctx, args) => {
    const instance = ctx.read.tables.eventInstances.get(args.eventInstanceId);
    if (instance === undefined) {
      return null;
    }
    const definition =
      instance.eventDefinitionId === null
        ? undefined
        : ctx.read.tables.eventDefinitions.get(instance.eventDefinitionId);
    return {
      ...calendarRowBuilder(ctx.read, ctx.viewer, ctx.date).stored(instance),
      placementTrace: placementTraceOf(ctx, instance),
      definition:
        definition === undefined ? null : { recurrenceText: recurrenceText(definition.recurrence) },
    };
  },
});

/** The statuses of a show that has neither run nor been cancelled. */
const OPEN_STATUSES = ['scheduled', 'booked'] as const;

export const nextShowQuery: QueryDefinition<'calendar.nextShow'> = defineQuery(
  'calendar.nextShow',
  {
    args: z.strictObject({ scope: z.enum(CALENDAR_SCOPES).optional() }),
    run: (ctx, args) => {
      const scope = args.scope ?? 'mine';
      if (scope === 'mine' && !canOwnShows(ctx.viewer)) {
        return null;
      }
      // The open shows are at most the horizon's worth, so reading them by status is cheaper than
      // walking the dates, and it finds a show however far ahead it is.
      let soonest: DeepReadonly<EventInstance>[] = [];
      for (const status of OPEN_STATUSES) {
        for (const instance of ctx.read.tables.eventInstances.lookup('byStatus', status)) {
          if (compareDates(instance.date, ctx.date) < 0 || !isWanted(ctx, instance, { scope })) {
            continue;
          }
          const [current] = soonest;
          const order = current === undefined ? -1 : compareDates(instance.date, current.date);
          if (order < 0) {
            soonest = [instance];
          } else if (order === 0) {
            soonest.push(instance);
          }
        }
      }
      const rows = calendarRowBuilder(ctx.read, ctx.viewer, ctx.date);
      const [show] = soonest.map((instance) => rows.stored(instance)).sort(compareCalendarShows);
      return show === undefined ? null : { show, daysUntil: diffDays(ctx.date, show.date) };
    },
  },
);

export const calendarQueries: readonly QueryDefinition[] = [
  rangeQuery,
  projectedQuery,
  showQuery,
  nextShowQuery,
];
