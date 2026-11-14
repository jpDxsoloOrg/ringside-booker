/**
 * The storylines system's queries (CRTV3-01): the Storylines desk's list and detail, a person's
 * storylines and the people who may join one.
 *
 * Viewer rules (docs/design/storylines.md#viewer-rules): own storylines in full; rival storylines
 * as public rows only (names, dates, brand, members and sides), never heat, counts, timelines or
 * traces. Nothing here has a duration, length or minute field (D-10).
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type {
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  StorylineId,
} from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import {
  PUSH_LEVELS,
  promotionStatusKey,
  type Alignment,
  type Employment,
  type EmploymentRole,
  type Push,
} from '../../model/entities/employment';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Gender } from '../../model/entities/person';
import type { Segment, SegmentKind } from '../../model/entities/segment';
import type { Storyline } from '../../model/entities/storyline';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import {
  activeEmploymentAt,
  buildStorylineRow,
  compareStorylineRows,
  editsStorylinesOf,
  seesStorylinesOf,
  type StorylineRow,
} from './rows';
import { daysSinceProgress } from './context';
import { storylinePayoffTraceRef, storylineStarterTraceRef } from './traceKinds';

/** The reason codes these queries refuse with. */
export const STORYLINE_REASONS = {
  noPromotion: 'storylines.noPromotion',
  notYours: 'storylines.notYours',
  notFound: 'storylines.notFound',
} as const;

export const STORYLINES_NO_PROMOTION_MESSAGE = 'Pick a promotion to see its storylines.';
export const STORYLINES_NOT_YOURS_MESSAGE = 'You can only pick people for your own storylines.';
export const STORYLINE_NOT_FOUND_MESSAGE = "That storyline doesn't exist.";
export const STORYLINES_PROMOTION_NOT_FOUND_MESSAGE = "That promotion doesn't exist.";
export const STORYLINES_PERSON_NOT_FOUND_MESSAGE = "That person doesn't exist.";

export const STORYLINE_LIST_STATUSES = ['active', 'ended', 'all'] as const;
export type StorylineListStatus = (typeof STORYLINE_LIST_STATUSES)[number];

/** `storylines.list`: one promotion's storylines. */
export interface StorylineListView {
  promotionId: PromotionId;
  /** Active first, hottest first then by name; ended after, most recently ended first. */
  rows: StorylineRow[];
  /** Active storylines of the promotion. */
  activeCount: number;
  /** `storylines.activeSoftLimit`: creating more than this many active storylines warns. */
  softLimit: number;
  /** `storylines.heat.hotFrom`. */
  hotFrom: number;
  /** True when the viewer runs the promotion and may create or change its storylines. */
  editable: boolean;
}

/** `storylines.forPerson`: the storylines one person is in, across every promotion. */
export interface StorylinesForPersonView {
  personId: PersonId;
  rows: StorylineRow[];
}

/** One person who may join a storyline of the promotion. */
export interface StorylineMemberOption {
  personId: PersonId;
  name: string;
  role: EmploymentRole;
  alignment: Alignment;
  push: Push;
  gender: Gender;
  imageRef: string | null;
  /** Active storylines of this promotion they are already in. */
  activeStorylineCount: number;
}

/** `storylines.memberOptions`: everyone under an active contract with the promotion. */
export interface StorylineMemberOptionsView {
  promotionId: PromotionId;
  /** Wrestlers first, then by push (top of the card first), then by name. */
  options: StorylineMemberOption[];
}

/** One segment that links the storyline. No duration, length or minutes (D-10). */
export interface StorylineTimelineEntry {
  segmentId: SegmentId;
  eventInstanceId: EventInstanceId;
  eventName: string;
  date: GameDate;
  slot: number;
  preShow: boolean;
  kind: SegmentKind;
  /** The billing line, else who was in it: "Ise vs Kuroe", "Ise & Kuroe". */
  label: string;
  /** Null until the show has run. */
  stars: number | null;
  /** The ref key of the segment's rating trace, or null. */
  ratingTraceId: string | null;
  /** True for the segment booked as the story's finale. */
  isFinale: boolean;
}

/**
 * Why an ended storyline did or did not pay off: `paid` (its payoff record says it paid, CRTV4-03),
 * `tooFew` (fewer counted segments than `storylines.payoff.minSegments`) or `notAvailable` (it
 * ended before payoffs existed, so there is no record).
 */
export const STORYLINE_PAYOFFS = ['tooFew', 'notAvailable', 'paid'] as const;
export type StorylinePayoff = (typeof STORYLINE_PAYOFFS)[number];

/** How an ended storyline ended. */
export interface StorylineEndingView {
  endedOn: GameDate;
  linkedSegments: number;
  minSegments: number;
  payoff: StorylinePayoff;
  /** The payoff trace when `payoff` is `paid` and the trace is kept, else null. */
  payoffTraceRef: TraceRef | null;
}

/**
 * How an active storyline's heat cools (CRTV3-02), so the screen can say "Cools from day 8 without
 * progress" or "Cooling 1 per day". Docs: docs/design/storylines.md#heat-decay.
 */
export interface StorylineCoolingView {
  /** `storylines.heat.decayGraceDays`. */
  graceDays: number;
  daysSinceProgress: number;
  /** `storylines.heat.decayPerDay`; 0 means heat never cools. */
  perDay: number;
  /** `storylines.heat.decayFloor`. */
  floor: number;
  /** True when the next simulated day lowers heat. */
  coolingNow: boolean;
  /**
   * Days from today until the first day that cools, if nothing moves the story on (a storyline
   * started today: grace + 1). Null when it is already cooling, the heat is at or below the floor,
   * or cooling is turned off.
   */
  startsInDays: number | null;
}

/** `storylines.detail`: one storyline with its summary, timeline and ending. */
export type StorylineDetail = StorylineRow & {
  /** The booker's summary; empty for a rival storyline. */
  summary: string;
  /** Show date, then pre-show first, then slot. Empty for a rival storyline. */
  timeline: StorylineTimelineEntry[];
  /** Null while active, and for a rival storyline. */
  ending: StorylineEndingView | null;
  /** Null for an ended storyline and a rival's. */
  cooling: StorylineCoolingView | null;
  /**
   * Why a starter storyline was picked at new game; null for any other storyline and for a
   * rival's.
   */
  startedBecauseTraceRef: TraceRef | null;
};

declare module '../../core/api/maps' {
  interface QueryMap {
    'storylines.list': {
      args: {
        promotionId?: PromotionId | undefined;
        status?: StorylineListStatus | undefined;
      };
      result: StorylineListView;
    };
    'storylines.detail': {
      args: { storylineId: StorylineId };
      result: StorylineDetail;
    };
    'storylines.forPerson': {
      args: { personId: PersonId; includeEnded?: boolean | undefined };
      result: StorylinesForPersonView;
    };
    'storylines.memberOptions': {
      args: { promotionId?: PromotionId | undefined };
      result: StorylineMemberOptionsView;
    };
  }
}

function rowFor(ctx: QueryContext, storyline: DeepReadonly<Storyline>): StorylineRow {
  return buildStorylineRow(ctx.read, storyline, {
    full: seesStorylinesOf(ctx.read, ctx.viewer, storyline.promotionId),
    editable: editsStorylinesOf(ctx.read, ctx.viewer, storyline.promotionId),
    traces: ctx.traces,
    tunables: ctx.tunables,
    date: ctx.date,
  });
}

/** The promotion asked about, else the viewer's first; refuses when there is neither. */
function promotionFor(ctx: QueryContext, promotionId: PromotionId | undefined): PromotionId {
  const chosen = promotionId ?? viewerPromotionIds(ctx.read, ctx.viewer)[0];
  if (chosen === undefined) {
    return refuseQuery({
      code: STORYLINE_REASONS.noPromotion,
      message: STORYLINES_NO_PROMOTION_MESSAGE,
    });
  }
  if (ctx.read.tables.promotions.get(chosen) === undefined) {
    return refuseQuery({
      code: 'notFound',
      message: STORYLINES_PROMOTION_NOT_FOUND_MESSAGE,
      field: 'promotionId',
    });
  }
  return chosen;
}

export const storylinesListQuery: QueryDefinition<'storylines.list'> = defineQuery(
  'storylines.list',
  {
    args: z.strictObject({
      promotionId: zId('promotion').optional(),
      status: z.enum(STORYLINE_LIST_STATUSES).optional(),
    }),
    run: (ctx, args) => {
      const promotionId = promotionFor(ctx, args.promotionId);
      const status = args.status ?? 'active';
      const storylines = ctx.read.tables.storylines.lookup('byPromotion', promotionId);
      const rows = storylines
        .filter((storyline) => status === 'all' || storyline.status === status)
        .map((storyline) => rowFor(ctx, storyline))
        .sort(compareStorylineRows);
      return {
        promotionId,
        rows,
        activeCount: storylines.filter((storyline) => storyline.status === 'active').length,
        softLimit: ctx.tunables.get('storylines.activeSoftLimit'),
        hotFrom: ctx.tunables.get('storylines.heat.hotFrom'),
        editable: editsStorylinesOf(ctx.read, ctx.viewer, promotionId),
      };
    },
  },
);

export const storylinesForPersonQuery: QueryDefinition<'storylines.forPerson'> = defineQuery(
  'storylines.forPerson',
  {
    args: z.strictObject({
      personId: zId('person'),
      includeEnded: z.boolean().optional(),
    }),
    run: (ctx, args) => {
      if (ctx.read.tables.people.get(args.personId) === undefined) {
        return refuseQuery({
          code: 'notFound',
          message: STORYLINES_PERSON_NOT_FOUND_MESSAGE,
          field: 'personId',
        });
      }
      const includeEnded = args.includeEnded ?? false;
      const rows = ctx.read.tables.storylines
        .lookup('byMember', args.personId)
        .filter((storyline) => includeEnded || storyline.status === 'active')
        .map((storyline) => rowFor(ctx, storyline))
        .sort(compareStorylineRows);
      return { personId: args.personId, rows };
    },
  },
);

function compareOptions(left: StorylineMemberOption, right: StorylineMemberOption): number {
  const wrestler = (option: StorylineMemberOption): number => (option.role === 'wrestler' ? 0 : 1);
  return (
    wrestler(left) - wrestler(right) ||
    PUSH_LEVELS.indexOf(left.push) - PUSH_LEVELS.indexOf(right.push) ||
    left.name.localeCompare(right.name, 'en') ||
    compareIds(left.personId, right.personId)
  );
}

export const storylinesMemberOptionsQuery: QueryDefinition<'storylines.memberOptions'> =
  defineQuery('storylines.memberOptions', {
    args: z.strictObject({ promotionId: zId('promotion').optional() }),
    run: (ctx, args) => {
      const promotionId = promotionFor(ctx, args.promotionId);
      if (!seesStorylinesOf(ctx.read, ctx.viewer, promotionId)) {
        return refuseQuery({
          code: STORYLINE_REASONS.notYours,
          message: STORYLINES_NOT_YOURS_MESSAGE,
          field: 'promotionId',
        });
      }
      const activeCounts = new Map<PersonId, number>();
      for (const storyline of ctx.read.tables.storylines.lookup('byPromotion', promotionId)) {
        if (storyline.status !== 'active') continue;
        for (const member of storyline.members) {
          activeCounts.set(member.personId, (activeCounts.get(member.personId) ?? 0) + 1);
        }
      }
      // One option per person: the lowest-id active employment, as the rows name them.
      const employments = new Map<PersonId, DeepReadonly<Employment>>();
      for (const employment of ctx.read.tables.employments.lookup(
        'byPromotionStatus',
        promotionStatusKey(promotionId, 'active'),
      )) {
        const known = employments.get(employment.personId);
        if (known === undefined || compareIds(employment.id, known.id) < 0) {
          employments.set(employment.personId, employment);
        }
      }
      const options = [...employments.values()].map((employment): StorylineMemberOption => {
        const person = ctx.read.tables.people.require(employment.personId);
        return {
          personId: person.id,
          name: employment.ringName,
          role: employment.role,
          alignment: employment.alignment,
          push: employment.push,
          gender: person.gender,
          imageRef: person.imageRef,
          activeStorylineCount: activeCounts.get(person.id) ?? 0,
        };
      });
      return { promotionId, options: options.sort(compareOptions) };
    },
  });

/** "Ise vs Kuroe" for a match, "Ise & Kuroe" for a talking segment, else the kind in words. */
export function segmentLabel(
  ctx: QueryContext,
  segment: DeepReadonly<Segment>,
  promotionId: PromotionId,
): string {
  if (segment.label !== null) {
    return segment.label;
  }
  const sides = new Map<number, string[]>();
  const participants = [...ctx.read.tables.participants.lookup('bySegment', segment.id)]
    .filter((participant) =>
      segment.kind === 'match'
        ? participant.role === 'competitor'
        : participant.role !== 'ringside' && participant.role !== 'interferer',
    )
    .sort((left, right) => left.side - right.side || compareIds(left.id, right.id));
  for (const participant of participants) {
    const name =
      activeEmploymentAt(ctx.read, participant.personId, promotionId)?.ringName ??
      ctx.read.tables.people.get(participant.personId)?.defaultRingName ??
      participant.personId;
    const side = segment.kind === 'match' ? participant.side : 0;
    const names = sides.get(side);
    if (names === undefined) sides.set(side, [name]);
    else names.push(name);
  }
  if (sides.size === 0) {
    return segment.kind === 'match' ? 'Match' : 'Talking segment';
  }
  return [...sides.values()].map((names) => names.join(' & ')).join(' vs ');
}

function timelineOf(
  ctx: QueryContext,
  storyline: DeepReadonly<Storyline>,
): StorylineTimelineEntry[] {
  const entries: StorylineTimelineEntry[] = [];
  for (const segment of ctx.read.tables.segments.lookup('byStoryline', storyline.id)) {
    const instance: DeepReadonly<EventInstance> | undefined = ctx.read.tables.eventInstances.get(
      segment.eventInstanceId,
    );
    if (instance === undefined) continue;
    entries.push({
      segmentId: segment.id,
      eventInstanceId: instance.id,
      eventName: instance.name,
      date: instance.date,
      slot: segment.slot,
      preShow: segment.preShow,
      kind: segment.kind,
      label: segmentLabel(ctx, segment, instance.promotionId),
      stars: segment.rating?.stars ?? null,
      ratingTraceId: segment.rating?.traceId ?? null,
      isFinale: storyline.finaleSegmentId === segment.id,
    });
  }
  return entries.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      compareIds(left.eventInstanceId, right.eventInstanceId) ||
      Number(right.preShow) - Number(left.preShow) ||
      left.slot - right.slot,
  );
}

function endingOf(
  ctx: QueryContext,
  storyline: DeepReadonly<Storyline>,
  linkedSegments: number,
): StorylineEndingView | null {
  if (storyline.status !== 'ended' || storyline.endedOn === null) {
    return null;
  }
  const minSegments = ctx.tunables.get('storylines.payoff.minSegments');
  const payoffRef = storylinePayoffTraceRef(storyline.id);
  const record = storyline.payoff;
  if (record === null) {
    // Ended before the payoff (CRTV4-03) existed: only the threshold can be told.
    return {
      endedOn: storyline.endedOn,
      linkedSegments,
      minSegments,
      payoff: linkedSegments < minSegments ? 'tooFew' : 'notAvailable',
      payoffTraceRef: null,
    };
  }
  return {
    endedOn: storyline.endedOn,
    linkedSegments: record.countedSegments,
    minSegments,
    payoff: record.paid ? 'paid' : 'tooFew',
    payoffTraceRef: record.paid && ctx.traces.has(payoffRef) ? payoffRef : null,
  };
}

function coolingOf(
  ctx: QueryContext,
  storyline: DeepReadonly<Storyline>,
): StorylineCoolingView | null {
  if (storyline.status !== 'active') {
    return null;
  }
  const graceDays = ctx.tunables.get('storylines.heat.decayGraceDays');
  const perDay = ctx.tunables.get('storylines.heat.decayPerDay');
  const floor = ctx.tunables.get('storylines.heat.decayFloor');
  const days = daysSinceProgress(storyline, ctx.date);
  const canCool = perDay > 0 && storyline.heat > floor;
  // The query's date is the next day to be simulated: its cooling step sees `days`.
  const coolingNow = canCool && days > graceDays;
  return {
    graceDays,
    daysSinceProgress: days,
    perDay,
    floor,
    coolingNow,
    startsInDays: canCool && !coolingNow ? graceDays + 1 - days : null,
  };
}

export const storylinesDetailQuery: QueryDefinition<'storylines.detail'> = defineQuery(
  'storylines.detail',
  {
    args: z.strictObject({ storylineId: zId('storyline') }),
    run: (ctx, args) => {
      const storyline = ctx.read.tables.storylines.get(args.storylineId);
      if (storyline === undefined) {
        return refuseQuery({
          code: STORYLINE_REASONS.notFound,
          message: STORYLINE_NOT_FOUND_MESSAGE,
          field: 'storylineId',
        });
      }
      const row = rowFor(ctx, storyline);
      if (row.linkedSegmentCount === null) {
        // A rival's storyline: the public row only, without the booker's own summary.
        return {
          ...row,
          summary: '',
          timeline: [],
          ending: null,
          cooling: null,
          startedBecauseTraceRef: null,
        };
      }
      const starterRef = storylineStarterTraceRef(storyline.id);
      return {
        ...row,
        summary: storyline.summary,
        timeline: timelineOf(ctx, storyline),
        ending: endingOf(ctx, storyline, row.linkedSegmentCount),
        cooling: coolingOf(ctx, storyline),
        startedBecauseTraceRef: ctx.traces.has(starterRef) ? starterRef : null,
      };
    },
  },
);

export const storylinesQueries: readonly QueryDefinition[] = [
  storylinesListQuery,
  storylinesDetailQuery,
  storylinesForPersonQuery,
  storylinesMemberOptionsQuery,
];
