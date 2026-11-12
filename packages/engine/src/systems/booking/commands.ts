/**
 * The booking commands: the six ways a booker changes a card.
 *
 * Every card change a person makes goes through one of these (D-07), so it names the controller
 * that issued it and lands in the command log. Each command's `validate` asks, in this order:
 *
 * 1. does the show (or segment) exist (`showNotFound`, `segmentNotFound`);
 * 2. does the issuer run the show, by the calendar's one rule (`notYourShow`): the brand's
 *    controller when the brand has one, else the promotion's;
 * 3. can the card still change (`editBlockOf`: `showCompleted`, `showCancelled`, `showPast`,
 *    `cardLocked`);
 * 4. is the change itself sound (`structuralProblems`, the writer's own rules).
 *
 * `apply` then calls the card writer once, so the change happens whole or not at all, and publishes
 * one `card.changed`. A command that would change nothing (the same draft, a move onto its own
 * slot, the same result, clearing an empty card) succeeds and publishes nothing.
 *
 * Locking and unlocking a card come with the booking checks in EVT2-04.
 *
 * Design notes: docs/design/booking.md#commands.
 */

import { z } from 'zod';
import { defineCommand, type CommandContext } from '../../core/api/command';
import type { Reason } from '../../core/api/result';
import { stableStringify } from '../../core/hash';
import type { EventInstanceId, SegmentId } from '../../core/ids';
import type { Controller } from '../../model/controller';
import type { EventInstance } from '../../model/entities/event-instance';
import { MatchOutcomeSchema, type MatchOutcome, type Segment } from '../../model/entities/segment';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { controlsShow } from '../calendar/control';
import { editBlockOf } from './control';
import { draftFromSegment, SegmentDraftSchema, type SegmentDraft } from './draft';
import type { CardChange } from './events';
import {
  clearCard,
  moveSegment,
  removeSegment,
  setPlannedOutcome,
  structuralProblems,
  writeSegment,
  type StructuralProblemCode,
} from './writer';

/** `booking.addSegment`: put a new segment in an open slot. */
export interface AddSegmentArgs {
  eventInstanceId: EventInstanceId;
  /** True for the pre-show, false for the main card. */
  preShow: boolean;
  /** 0-based slot in that section. */
  slot: number;
  draft: SegmentDraft;
}

/** `booking.updateSegment`: replace a segment's whole draft; it keeps its id and its slot. */
export interface UpdateSegmentArgs {
  segmentId: SegmentId;
  draft: SegmentDraft;
}

/** `booking.moveSegment`: move a segment, swapping with whatever is in the target slot. */
export interface MoveSegmentArgs {
  segmentId: SegmentId;
  toPreShow: boolean;
  /** 0-based slot in the target section. */
  toSlot: number;
}

/** `booking.setResult`: a match's planned result, or null to decide it on the night. */
export interface SetResultArgs {
  segmentId: SegmentId;
  result: MatchOutcome | null;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'booking.addSegment': { args: AddSegmentArgs; result: { segmentId: SegmentId } };
    'booking.updateSegment': { args: UpdateSegmentArgs; result: { segmentId: SegmentId } };
    'booking.removeSegment': { args: { segmentId: SegmentId }; result: null };
    'booking.moveSegment': {
      args: MoveSegmentArgs;
      result: { swappedWith: SegmentId | null };
    };
    'booking.setResult': { args: SetResultArgs; result: null };
    'booking.clearCard': {
      args: { eventInstanceId: EventInstanceId };
      result: { removed: number };
    };
  }
}

/** The reason codes the booking commands add to `editBlockOf`'s and the writer's. */
export const BOOKING_COMMAND_REASON_CODES = [
  'showNotFound',
  'segmentNotFound',
  'notYourShow',
] as const;
export type BookingCommandReasonCode = (typeof BOOKING_COMMAND_REASON_CODES)[number];

type Show = DeepReadonly<EventInstance>;

// ---------------------------------------------------------------------------------------------
// Validation

function showNotFound(): Reason {
  return { code: 'showNotFound', message: 'That show no longer exists' };
}

function segmentNotFound(): Reason {
  return { code: 'segmentNotFound', message: 'That segment is no longer on the card' };
}

/** The name of whoever runs the show: its brand when the brand has its own controller. */
function runnerName(read: GameWorldView, show: Show): string {
  const brand = show.brandId === null ? undefined : read.tables.brands.get(show.brandId);
  if (brand !== undefined && brand.controller !== null) {
    return brand.name;
  }
  return read.tables.promotions.get(show.promotionId)?.name ?? 'this promotion';
}

/**
 * Why `issuedBy` may not change `show`'s card today: not their show, or a card that cannot change
 * any more. Empty when they may.
 */
function showRefusals(read: GameWorldView, show: Show, issuedBy: Controller): Reason[] {
  if (!controlsShow(read, show, issuedBy)) {
    return [
      {
        code: 'notYourShow',
        message: `Only the person running ${runnerName(read, show)} can book this show`,
        subject: { kind: 'eventInstance', id: show.id },
      },
    ];
  }
  const blocked = editBlockOf(read, show, read.meta.currentDate);
  return blocked === null ? [] : [blocked];
}

/** Checks the show by id, then hands the sound ones to `then` for the command's own rules. */
function checkShow(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  issuedBy: Controller,
  then: (show: Show) => Reason[],
): Reason[] {
  const show = read.tables.eventInstances.get(eventInstanceId);
  if (show === undefined) {
    return [showNotFound()];
  }
  const refused = showRefusals(read, show, issuedBy);
  return refused.length > 0 ? refused : then(show);
}

/** Checks the segment and its show, then hands them to `then` for the command's own rules. */
function checkSegment(
  read: GameWorldView,
  segmentId: SegmentId,
  issuedBy: Controller,
  then: (segment: DeepReadonly<Segment>, show: Show) => Reason[],
): Reason[] {
  const segment = read.tables.segments.get(segmentId);
  if (segment === undefined) {
    return [segmentNotFound()];
  }
  return checkShow(read, segment.eventInstanceId, issuedBy, (show) => then(segment, show));
}

function onlyCodes(reasons: Reason[], codes: readonly StructuralProblemCode[]): Reason[] {
  return reasons.filter((reason) => (codes as readonly string[]).includes(reason.code));
}

// ---------------------------------------------------------------------------------------------
// Applying

function announce(
  ctx: CommandContext,
  show: Show,
  segmentId: SegmentId | null,
  change: CardChange,
): void {
  ctx.publish('card.changed', {
    eventInstanceId: show.id,
    promotionId: show.promotionId,
    brandId: show.brandId,
    segmentId,
    change,
  });
}

/** The segment and its show, inside `apply` (validate has already checked both exist). */
function segmentAndShow(
  ctx: CommandContext,
  segmentId: SegmentId,
): { segment: DeepReadonly<Segment>; show: Show } {
  const segment = ctx.read.tables.segments.require(segmentId);
  return { segment, show: ctx.read.tables.eventInstances.require(segment.eventInstanceId) };
}

const segmentIdArgs = { segmentId: zId('segment') };
const slotArg = z.number().int().min(0);

// ---------------------------------------------------------------------------------------------
// Commands

/** Puts a new segment in an open slot of the card. */
export const addSegmentCommand = defineCommand('booking.addSegment', {
  args: z.strictObject({
    eventInstanceId: zId('eventInstance'),
    preShow: z.boolean(),
    slot: slotArg,
    draft: SegmentDraftSchema,
  }),
  validate: (read, args, issuedBy) =>
    checkShow(read, args.eventInstanceId, issuedBy, (show) =>
      structuralProblems(read, {
        instance: show,
        draft: args.draft,
        target: { preShow: args.preShow, slot: args.slot },
      }),
    ),
  apply: (ctx, args) => {
    const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
    const segmentId = writeSegment(ctx.tx, {
      eventInstanceId: show.id,
      preShow: args.preShow,
      slot: args.slot,
      draft: args.draft,
    });
    announce(ctx, show, segmentId, 'added');
    return { segmentId };
  },
});

/**
 * Replaces a segment's whole draft in place. Later editor sections (finish, beats, stipulations,
 * crew, storylines) change only their part of the draft and save through here, so there is one
 * write path for every edit.
 */
export const updateSegmentCommand = defineCommand('booking.updateSegment', {
  args: z.strictObject({ ...segmentIdArgs, draft: SegmentDraftSchema }),
  validate: (read, args, issuedBy) =>
    checkSegment(read, args.segmentId, issuedBy, (segment, show) =>
      structuralProblems(read, {
        instance: show,
        draft: args.draft,
        target: { preShow: segment.preShow, slot: segment.slot, segmentId: segment.id },
      }),
    ),
  apply: (ctx, args) => {
    const { segment, show } = segmentAndShow(ctx, args.segmentId);
    const before = stableStringify(draftFromSegment(ctx.read, segment.id));
    writeSegment(ctx.tx, {
      eventInstanceId: show.id,
      preShow: segment.preShow,
      slot: segment.slot,
      draft: args.draft,
      segmentId: segment.id,
    });
    if (stableStringify(draftFromSegment(ctx.read, segment.id)) !== before) {
      announce(ctx, show, segment.id, 'updated');
    }
    return { segmentId: segment.id };
  },
});

/** Takes a segment off the card. Its slot becomes open; nothing else moves. */
export const removeSegmentCommand = defineCommand('booking.removeSegment', {
  args: z.strictObject(segmentIdArgs),
  validate: (read, args, issuedBy) => checkSegment(read, args.segmentId, issuedBy, () => []),
  apply: (ctx, args) => {
    const { segment, show } = segmentAndShow(ctx, args.segmentId);
    removeSegment(ctx.tx, segment.id);
    announce(ctx, show, segment.id, 'removed');
    return null;
  },
});

/**
 * Moves a segment to another slot, in its section or the other one. A filled target slot swaps:
 * its segment goes to where the moving one was.
 */
export const moveSegmentCommand = defineCommand('booking.moveSegment', {
  args: z.strictObject({ ...segmentIdArgs, toPreShow: z.boolean(), toSlot: slotArg }),
  validate: (read, args, issuedBy) =>
    checkSegment(read, args.segmentId, issuedBy, (segment, show) =>
      // Only the target slot matters: the segment itself is already on the card as it is.
      onlyCodes(
        structuralProblems(read, {
          instance: show,
          draft: draftFromSegment(read, segment.id),
          target: { preShow: args.toPreShow, slot: args.toSlot, segmentId: segment.id },
        }),
        ['slotOutsideFormat'],
      ),
    ),
  apply: (ctx, args) => {
    const { segment, show } = segmentAndShow(ctx, args.segmentId);
    if (segment.preShow === args.toPreShow && segment.slot === args.toSlot) {
      return { swappedWith: null };
    }
    const moved = moveSegment(ctx.tx, segment.id, { preShow: args.toPreShow, slot: args.toSlot });
    announce(ctx, show, segment.id, 'moved');
    return moved;
  },
});

/**
 * Sets a match's planned result from the card row's quick winner menu, or clears it with null so
 * it is decided on the night. The segment editor sends the result inside its draft instead.
 */
export const setResultCommand = defineCommand('booking.setResult', {
  args: z.strictObject({ ...segmentIdArgs, result: MatchOutcomeSchema.nullable() }),
  validate: (read, args, issuedBy) =>
    checkSegment(read, args.segmentId, issuedBy, (segment, show) => {
      if (segment.kind !== 'match') {
        return [
          {
            code: 'notAMatch',
            message: 'Only a match has a result to plan',
            subject: { kind: 'segment', id: segment.id },
          },
        ];
      }
      const draft = draftFromSegment(read, segment.id);
      if (draft.kind !== 'match') {
        return [];
      }
      return onlyCodes(
        structuralProblems(read, {
          instance: show,
          draft: { ...draft, outcome: args.result },
          target: { preShow: segment.preShow, slot: segment.slot, segmentId: segment.id },
        }),
        ['winnerWithoutCompetitor', 'unknownMethod'],
      );
    }),
  apply: (ctx, args) => {
    const { segment, show } = segmentAndShow(ctx, args.segmentId);
    const current = segment.kind === 'match' ? segment.outcome : null;
    if (stableStringify(current) === stableStringify(args.result)) {
      return null;
    }
    setPlannedOutcome(ctx.tx, segment.id, args.result);
    announce(ctx, show, segment.id, 'result');
    return null;
  },
});

/** Takes every segment off the card. */
export const clearCardCommand = defineCommand('booking.clearCard', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  validate: (read, args, issuedBy) => checkShow(read, args.eventInstanceId, issuedBy, () => []),
  apply: (ctx, args) => {
    const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
    const removed = clearCard(ctx.tx, show.id).length;
    if (removed > 0) {
      announce(ctx, show, null, 'cleared');
    }
    return { removed };
  },
});

export const bookingCommands = [
  addSegmentCommand,
  updateSegmentCommand,
  removeSegmentCommand,
  moveSegmentCommand,
  setResultCommand,
  clearCardCommand,
] as const;
