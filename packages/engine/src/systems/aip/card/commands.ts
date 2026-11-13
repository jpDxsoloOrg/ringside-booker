/**
 * `aip.autoFillCard`: the rival booker, lent to the player for their own show (AIP4-06).
 *
 * Auto-fill fills the open slots of a card the player can edit (or rebuilds the whole card when
 * asked), with a short reason per slot and a Why? behind it. It only suggests: every segment it
 * writes is an ordinary segment the player can change, move or remove, it never plans a winner
 * (`outcome: null`, whatever MTCH2's Random winners says) and it never cancels or runs the show.
 * The player still runs the show from the show screen.
 *
 * Rules, in the booking commands' order: the show exists (`showNotFound`); the issuer runs it
 * (`notYourShow`, by the calendar's one rule); the card can still change (EVT2's `editBlockOf`:
 * `showCompleted`, `showCancelled`, `showPast`); the world has match types (`noCatalog`); and, when
 * only open slots are wanted, there is one (`cardFull`).
 *
 * The plan comes from `planCard` with the `aip.autofill` stream, never `aip.card`, so pressing
 * Auto-fill never changes what the rivals book. Rebuilding plans in `fresh` mode before anything is
 * cleared, so a plan that cannot fill the card (a thin roster) leaves the card as it was. A
 * `cancel` plan is a message, not a cancellation. The booked-card steps (AIP5's winners) belong to
 * the rival show-day job and never run here.
 *
 * Each written segment gets the same short Why? a rival slot gets (`aip.cardSlot`, headline reasons
 * and card score; a few kilobytes), demoted to a summary once the show is
 * `history.keepDetailDays` old. Design: docs/design/rival-booking.md#auto-fill.
 */

import { z } from 'zod';
import { defineCommand, type CommandContext } from '../../../core/api/command';
import type { Reason } from '../../../core/api/result';
import type { EventInstanceId, SegmentId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import { matchTypesOf } from '../../../model/catalogs';
import type { EventInstance } from '../../../model/entities/event-instance';
import { zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments } from '../../booking/card';
import { runnerName } from '../../booking/commands';
import { editBlockOf } from '../../booking/control';
import type { CardChange } from '../../booking/events';
import { clearCard, structuralProblems, writeSegment } from '../../booking/writer';
import { controlsShow } from '../../calendar/control';
import { SLOT_ROLE_LABELS, slotRoleOf } from '../../match/slots';
import type { EngineTunables } from '../../tunables';
import { CARD_SLOT_TRACE_KIND, slotSummaryTrace } from './bookShowJob';
import { planCard, type PlannedPlacement } from './planCard';
import { AUTOFILL_STREAM } from './streams';

export const AUTO_FILL_COMMAND = 'aip.autoFillCard';
export const CARD_FULL_MESSAGE = 'Every slot is already filled';
export const NO_CATALOG_MESSAGE = 'This save has no match types to book from';
export const SHOW_NOT_FOUND_MESSAGE = 'That show no longer exists';

/** The reason codes Auto-fill adds to `editBlockOf`'s. */
export const AUTO_FILL_REASON_CODES = [
  'showNotFound',
  'notYourShow',
  'cardFull',
  'noCatalog',
] as const;
export type AutoFillReasonCode = (typeof AUTO_FILL_REASON_CODES)[number];

export interface AutoFillCardArgs {
  eventInstanceId: EventInstanceId;
  /** True (the default): fill only the open slots. False: clear the card and plan it all. */
  keepFilledSlots?: boolean | undefined;
}

/** One slot Auto-fill filled. */
export interface AutoFilledSlot {
  segmentId: SegmentId;
  preShow: boolean;
  /** What the player reads: the stored slot + 1. */
  displayNumber: number;
  /** "Opener", "Midcard", "Main event", "Pre-show". */
  roleLabel: string;
  /** The matchup ("Ace vs Rookie") or the talking segment's speakers. */
  label: string;
  /** Two or three short reasons ("Tessen Heavyweight Championship: due, 34 days since the last defence"). */
  headline: string[];
  /** The slot's Why? (`aip.cardSlot`). */
  traceRef: TraceRef;
}

/** A slot Auto-fill left open, and why. */
export interface AutoFillOpenSlot {
  displayNumber: number;
  preShow: boolean;
  reason: string;
}

export interface AutoFillResult {
  /** In running order: the pre-show first, then the main card. */
  filled: AutoFilledSlot[];
  open: AutoFillOpenSlot[];
  /** Segments that were on the card and stayed. */
  kept: number;
  /** Why nothing was filled ("Only 4 wrestlers available, needs 5"), else null. */
  message: string | null;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'aip.autoFillCard': { args: AutoFillCardArgs; result: AutoFillResult };
  }
}

type Show = DeepReadonly<EventInstance>;

/** The slots Auto-fill may fill: the main card, and the pre-show while the planner fills it. */
function fillableSlotCount(show: Show, tunables: EngineTunables): number {
  return show.format.slots + (tunables.get('aip.card.fillPreShow') ? show.format.preShowSlots : 0);
}

/** True when a slot Auto-fill could fill is still empty. */
function hasOpenSlot(read: GameWorldView, show: Show, tunables: EngineTunables): boolean {
  const filled = cardSegments(read, show.id).filter(
    (segment) => !segment.preShow || tunables.get('aip.card.fillPreShow'),
  ).length;
  return filled < fillableSlotCount(show, tunables);
}

function validateAutoFill(
  read: GameWorldView,
  args: AutoFillCardArgs,
  issuedBy: Parameters<typeof controlsShow>[2],
  tunables: EngineTunables,
): Reason[] {
  const show = read.tables.eventInstances.get(args.eventInstanceId);
  if (show === undefined) {
    return [{ code: 'showNotFound', message: SHOW_NOT_FOUND_MESSAGE, field: 'eventInstanceId' }];
  }
  const subject = { kind: 'eventInstance', id: show.id } as const;
  if (!controlsShow(read, show, issuedBy)) {
    return [
      {
        code: 'notYourShow',
        message: `Only the person running ${runnerName(read, show)} can book this show`,
        subject,
      },
    ];
  }
  const blocked = editBlockOf(read, show, read.meta.currentDate);
  if (blocked !== null) {
    return [blocked];
  }
  if (matchTypesOf(read).length === 0) {
    return [{ code: 'noCatalog', message: NO_CATALOG_MESSAGE, subject }];
  }
  if (args.keepFilledSlots !== false && !hasOpenSlot(read, show, tunables)) {
    return [{ code: 'cardFull', message: CARD_FULL_MESSAGE, subject }];
  }
  return [];
}

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

function roleLabelOf(show: Show, placement: PlannedPlacement, tunables: EngineTunables): string {
  const role = slotRoleOf(
    { slot: placement.slot + 1, slots: show.format.slots, preShow: placement.preShow },
    { tunables },
  );
  return SLOT_ROLE_LABELS[role.value];
}

function applyAutoFill(ctx: CommandContext, args: AutoFillCardArgs): AutoFillResult {
  const show = ctx.read.tables.eventInstances.require(args.eventInstanceId);
  const rebuild = args.keepFilledSlots === false;
  // Rebuilding plans as if the card were empty before clearing it, so a plan that cannot fill the
  // card leaves it as it was.
  const plan = planCard(
    ctx.read,
    { instance: show, today: ctx.date, mode: rebuild ? 'fresh' : 'keepFilled' },
    { tunables: ctx.tunables, rng: ctx.rng(AUTOFILL_STREAM) },
  );
  const onCard = cardSegments(ctx.read, show.id).length;
  if (plan.kind === 'cancel') {
    return { filled: [], open: [], kept: onCard, message: plan.reason };
  }

  if (rebuild && clearCard(ctx.tx, show.id).length > 0) {
    announce(ctx, show, null, 'cleared');
  }
  const kept = rebuild ? 0 : onCard;
  const filled: AutoFilledSlot[] = [];
  const open: AutoFillOpenSlot[] = plan.open.map((slot) => ({
    displayNumber: slot.slot + 1,
    preShow: slot.preShow,
    reason: slot.reason,
  }));
  for (const placement of plan.placements) {
    const target = { preShow: placement.preShow, slot: placement.slot };
    // Auto-fill never decides a result.
    const draft =
      placement.draft.kind === 'match' ? { ...placement.draft, outcome: null } : placement.draft;
    const problems = structuralProblems(ctx.read, { instance: show, draft, target });
    if (problems.length > 0) {
      open.push({
        displayNumber: placement.slot + 1,
        preShow: placement.preShow,
        reason: problems.map((problem) => problem.message).join('; '),
      });
      continue;
    }
    const segmentId = writeSegment(ctx.tx, { eventInstanceId: show.id, ...target, draft });
    const traceRef: TraceRef = { kind: CARD_SLOT_TRACE_KIND, id: segmentId };
    ctx.recordTrace(traceRef, ctx.date, slotSummaryTrace(placement));
    announce(ctx, show, segmentId, 'added');
    filled.push({
      segmentId,
      preShow: placement.preShow,
      displayNumber: placement.slot + 1,
      roleLabel: roleLabelOf(show, placement, ctx.tunables),
      label: placement.slotTrace.value,
      headline: [...placement.headline],
      traceRef,
    });
  }
  open.sort(
    (left, right) =>
      Number(right.preShow) - Number(left.preShow) || left.displayNumber - right.displayNumber,
  );
  return { filled, open, kept, message: null };
}

/** Fills the open slots of the player's own card (or the whole card) with the rival booker. */
export const autoFillCardCommand = defineCommand('aip.autoFillCard', {
  args: z.strictObject({
    eventInstanceId: zId('eventInstance'),
    keepFilledSlots: z.boolean().optional(),
  }),
  validate: (read, args, issuedBy, env) => validateAutoFill(read, args, issuedBy, env.tunables),
  apply: (ctx, args) => applyAutoFill(ctx, args),
});

export const aipCardCommands = [autoFillCardCommand] as const;
