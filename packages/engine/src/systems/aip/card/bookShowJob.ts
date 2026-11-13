/**
 * `aip.bookShow`: rivals book their own shows on show day (AIP4-05).
 *
 * A `beforeShow` job, so it runs in `aip.runTurns` (group `aiTurns`) before the shows group runs
 * the day's shows. For each of the unit's shows today that is still `scheduled` and that the
 * computer runs (`showControllerOf`), in ID order, inside a savepoint of its own so one bad show
 * never undoes another:
 *
 * 1. plan the card with `planCard`: `keepFilled` when the show already has segments (a brand
 *    handed to a computer GM after the player booked part of it), otherwise `fresh` on a cleared
 *    card. Draws come from the `aip.card` stream;
 * 2. a `cancel` plan cancels the show (`byPromotion`, `show.cancelled`) with the plan's reason;
 * 3. otherwise each placement goes through EVT2's card writer, the same code the player's commands
 *    use. A placement the writer would refuse (`structuralProblems`) is skipped with a log line and
 *    its slot stays open;
 * 4. the booked-card steps run (`bookedCardSteps.ts`: winners, crew, stipulations in later
 *    tickets);
 * 5. EVT2's `validateCard` checks the card. Matches without a planned winner are fine (AIP5 sets
 *    them, or show night's auto-winner decides). Any other error is a planner bug: the offending
 *    segments are removed and the card is checked once more. A card that still cannot run is
 *    taken off again and the show is cancelled with the check's message as the reason;
 * 6. a runnable card sets the show `booked` and publishes `aip.cardBooked`.
 *
 * Each show gets a `card` decision in the decision log, hidden until the show airs, pointing at
 * the show's plan trace (`aip.cardPlan`, summary-only), and each written segment a short trace
 * (`aip.cardSlot`: the slot, its headline reasons and its card score). Rival shows are never
 * stored with their full plan: a whole plan is hundreds of kilobytes. See
 * docs/design/rival-booking.md#show-day.
 */

import { parseContentKey } from '../../../core/content-key';
import type { SegmentId } from '../../../core/ids';
import { inputOf, startDecision, type Traced } from '../../../core/trace';
import type { TraceRef } from '../../../core/trace/store';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { TemplatedText } from '../../../model/primitives';
import type { DeepReadonly } from '../../../model/world';
import { cardSegments, hasCard } from '../../booking/card';
import { validateCard } from '../../booking/validate/validateCard';
import type { BookingIssue } from '../../booking/validate/types';
import { clearCard, removeSegment, structuralProblems, writeSegment } from '../../booking/writer';
import { cancelShow } from '../../calendar/cancel';
import { showControllerOf } from '../../calendar/control';
import { registerDecisionKind } from '../decisionKinds';
import { writeAiDecision } from '../decisions';
import type { AiJobContext } from '../jobs/context';
import { registerAiJob } from '../jobs/registry';
import { bookedCardSteps, type ShowBookingContext } from './bookedCardSteps';
import { planCard, slotTraceLabel, type CardPlan, type PlannedPlacement } from './planCard';
import { CARD_PLAN_STREAM } from './streams';
import { SHOW_DAY_DOC_REF } from './tunables';
import './events';

export const BOOK_SHOW_JOB_ID = 'aip.bookShow';
/** The decision kind of a rival card (booked or cancelled). */
export const CARD_DECISION_KIND = 'card';
/** The show's plan trace, by event instance id. Summary-only. */
export const CARD_PLAN_TRACE_KIND = 'aip.cardPlan';
/** One written segment's trace, by segment id: headline and card score. */
export const CARD_SLOT_TRACE_KIND = 'aip.cardSlot';
/** Params `show`, `matches`, `talking`, `titles`. */
export const CARD_BOOKED_SUMMARY_KEY = 'aip.decision.card-booked';
/** Params `show`, `reason`. */
export const SHOW_CANCELLED_SUMMARY_KEY = 'aip.decision.show-cancelled';
/** The longest failure message an `aip.jobFailed` event carries (as the runner's). */
const MAX_FAILURE_MESSAGE_LENGTH = 300;
/** The issue code `validateCard` gives a match with no planned winner; the booker ignores it. */
export const NO_PLANNED_RESULT_CODE = 'noPlannedResult';

registerDecisionKind({ kind: CARD_DECISION_KIND, chip: 'Card' });

/** The savepoint label of one show. */
export function bookShowSavepointLabel(eventInstanceId: string): string {
  return `aip.bookShow:${eventInstanceId}`;
}

/** "Slot 3" or "Pre-show slot 1", from a 0-based slot. */
function slotName(preShow: boolean, slot: number): string {
  return `${preShow ? 'Pre-show slot' : 'Slot'} ${String(slot + 1)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "Booked Monday Night Brawl: 5 matches, 2 talking segments, 1 title match". */
export function cardBookedText(summary: TemplatedText): string {
  const { show, matches, talking, titles } = summary.params;
  return `Booked ${String(show)}: ${plural(Number(matches ?? 0), 'match', 'matches')}, ${plural(Number(talking ?? 0), 'talking segment', 'talking segments')}, ${plural(Number(titles ?? 0), 'title match', 'title matches')}`;
}

/** "Cancelled Monday Night Brawl: Only 4 wrestlers available, needs 5". */
export function showCancelledText(summary: TemplatedText): string {
  return `Cancelled ${String(summary.params['show'])}: ${String(summary.params['reason'])}`;
}

/** A context whose events and traces wait until `flush`, so a rolled-back savepoint leaves none. */
function bufferedContext(
  parent: ShowBookingContext,
  tx: ShowBookingContext['tx'],
): { context: ShowBookingContext; flush: () => void } {
  const pending: (() => void)[] = [];
  const context: ShowBookingContext = {
    ...parent,
    tx,
    read: tx.view,
    publish: (type, payload) => {
      pending.push(() => {
        parent.publish(type, payload);
      });
    },
    recordTrace: (ref, date, traced, options) => {
      pending.push(() => {
        parent.recordTrace(ref, date, traced, options);
      });
    },
  };
  return {
    context,
    flush: () => {
      for (const deliver of pending) {
        deliver();
      }
    },
  };
}

/** The short Why? kept for a written segment: its slot, headline reasons and card score. */
export function slotSummaryTrace(placement: PlannedPlacement): Traced<string> {
  const decision = startDecision<string>(slotTraceLabel(placement.slot, roleOf(placement)), {
    docRef: SHOW_DAY_DOC_REF,
  });
  for (const line of placement.headline) {
    decision.note(line);
  }
  decision.include('Card score', inputOf('Card score', placement.cardScore));
  return decision.choose(placement.slotTrace.value, placement.headline[0] ?? 'Planned');
}

/** The role half of the full slot trace's label ("Slot 3 · Midcard" → "Midcard"). */
function roleOf(placement: PlannedPlacement): string {
  const label = placement.slotTrace.trace.label;
  const cut = label.indexOf(' · ');
  return cut < 0 ? label : label.slice(cut + 3);
}

interface WrittenSegment {
  readonly segmentId: SegmentId;
  readonly placement: PlannedPlacement;
}

type ShowOutcome =
  | { readonly kind: 'booked'; readonly segmentCount: number; readonly titleMatchCount: number }
  | { readonly kind: 'cancelled'; readonly reason: string };

/** The errors that stop a card from running, apart from matches with no planned winner. */
function blockingErrors(ctx: ShowBookingContext, instanceId: EventInstance['id']): BookingIssue[] {
  return validateCard(ctx.read, instanceId, {
    tunables: ctx.tunables,
    today: ctx.date,
  }).errors.filter((issue) => issue.code !== NO_PLANNED_RESULT_CODE);
}

/** Runs every booked-card step in its own savepoint; a step that throws is logged and skipped. */
function runBookedCardSteps(
  ctx: ShowBookingContext,
  instanceId: EventInstance['id'],
  written: readonly WrittenSegment[],
  plan: Extract<CardPlan, { kind: 'card' }>,
): void {
  for (const step of bookedCardSteps()) {
    const result = ctx.tx.savepoint(`aip.bookedCardStep:${step.id}`, (tx) => {
      const buffered = bufferedContext(ctx, tx);
      step.run(buffered.context, {
        instance: tx.view.tables.eventInstances.require(instanceId),
        segmentIds: written.map((entry) => entry.segmentId),
        plan,
      });
      return buffered.flush;
    });
    if (result.ok) {
      result.value();
    } else {
      ctx.log(`Booked-card step ${step.id} failed and was skipped: ${result.error.message}`);
    }
  }
}

/** Writes the plan's placements; skips (and notes) any the writer would refuse. */
function writePlacements(
  ctx: ShowBookingContext,
  instance: DeepReadonly<EventInstance>,
  plan: Extract<CardPlan, { kind: 'card' }>,
  notes: string[],
): WrittenSegment[] {
  const written: WrittenSegment[] = [];
  for (const placement of plan.placements) {
    const target = { preShow: placement.preShow, slot: placement.slot };
    const problems = structuralProblems(ctx.read, { instance, draft: placement.draft, target });
    if (problems.length > 0) {
      const message = problems.map((problem) => problem.message).join('; ');
      const line = `Left ${slotName(placement.preShow, placement.slot)} open: ${message}`;
      ctx.log(`${instance.name} (${instance.id}): ${line}`);
      notes.push(line);
      continue;
    }
    const segmentId = writeSegment(ctx.tx, {
      eventInstanceId: instance.id,
      ...target,
      // No planned winner: AIP5 sets winners through a booked-card step.
      draft:
        placement.draft.kind === 'match' ? { ...placement.draft, outcome: null } : placement.draft,
    });
    written.push({ segmentId, placement });
  }
  return written;
}

/**
 * Validates the card; removes the segments behind any error but a missing winner and validates
 * once more. Returns the errors still left (empty when the card can run).
 */
function validateAndRepair(
  ctx: ShowBookingContext,
  instance: DeepReadonly<EventInstance>,
  notes: string[],
): BookingIssue[] {
  const errors = blockingErrors(ctx, instance.id);
  if (errors.length === 0) {
    return [];
  }
  const onCard = new Set(cardSegments(ctx.read, instance.id).map((segment) => segment.id));
  const removed = new Set<SegmentId>();
  for (const issue of errors) {
    const segmentId = issue.segmentId;
    if (segmentId === undefined || removed.has(segmentId) || !onCard.has(segmentId)) {
      continue;
    }
    const segment = ctx.read.tables.segments.require(segmentId);
    removeSegment(ctx.tx, segmentId);
    removed.add(segmentId);
    const line = `Removed ${slotName(segment.preShow, segment.slot)}: ${issue.message}`;
    ctx.log(`${instance.name} (${instance.id}): ${line}`);
    notes.push(line);
  }
  return removed.size === 0 ? errors : blockingErrors(ctx, instance.id);
}

/** Plans, writes, checks and books (or cancels) one show. Runs inside the show's savepoint. */
function bookOneShow(
  ctx: ShowBookingContext,
  instance: DeepReadonly<EventInstance>,
): { outcome: ShowOutcome; planTrace: Traced<string>; counts: CardCounts } {
  const mode = hasCard(ctx.read, instance.id) ? 'keepFilled' : 'fresh';
  if (mode === 'fresh') {
    // Fresh plans as if the card were empty, so whatever is there goes first.
    clearCard(ctx.tx, instance.id);
  }
  const plan = planCard(
    ctx.read,
    { instance, today: ctx.date, mode },
    { tunables: ctx.tunables, rng: ctx.rng(CARD_PLAN_STREAM) },
  );
  const notes: string[] = [];
  if (plan.kind === 'cancel') {
    return {
      outcome: { kind: 'cancelled', reason: plan.reason },
      planTrace: showTrace(instance, plan, notes, 'cancelled', plan.reason),
      counts: EMPTY_COUNTS,
    };
  }

  const written = writePlacements(ctx, instance, plan, notes);
  runBookedCardSteps(ctx, instance.id, written, plan);
  const errors = validateAndRepair(ctx, instance, notes);
  const [firstError] = errors;
  if (firstError !== undefined) {
    // Take off what this booking wrote; segments that were already on the card stay.
    for (const entry of written) {
      if (ctx.read.tables.segments.has(entry.segmentId)) {
        removeSegment(ctx.tx, entry.segmentId);
      }
    }
    return {
      outcome: { kind: 'cancelled', reason: firstError.message },
      planTrace: showTrace(instance, plan, notes, 'cancelled', firstError.message),
      counts: EMPTY_COUNTS,
    };
  }

  const counts = countsOf(ctx, instance.id);
  for (const entry of written) {
    if (ctx.read.tables.segments.has(entry.segmentId)) {
      ctx.recordTrace(
        { kind: CARD_SLOT_TRACE_KIND, id: entry.segmentId },
        ctx.date,
        slotSummaryTrace(entry.placement),
      );
    }
  }
  const because = `${plural(counts.segments, 'segment', 'segments')} on the card`;
  return {
    outcome: {
      kind: 'booked',
      segmentCount: counts.segments,
      titleMatchCount: counts.titles,
    },
    planTrace: showTrace(instance, plan, notes, 'booked', because),
    counts,
  };
}

interface CardCounts {
  readonly segments: number;
  readonly matches: number;
  readonly talking: number;
  readonly titles: number;
}

const EMPTY_COUNTS: CardCounts = { segments: 0, matches: 0, talking: 0, titles: 0 };

/** What is on the card now, kept segments included. */
function countsOf(ctx: ShowBookingContext, instanceId: EventInstance['id']): CardCounts {
  const segments = cardSegments(ctx.read, instanceId);
  return {
    segments: segments.length,
    matches: segments.filter((segment) => segment.kind === 'match').length,
    talking: segments.filter((segment) => segment.kind === 'angle').length,
    titles: segments.filter(
      (segment) => segment.kind === 'match' && segment.match.titleIds.length > 0,
    ).length,
  };
}

/** The show's plan trace: the plan, then what happened when it was written. */
function showTrace(
  instance: DeepReadonly<EventInstance>,
  plan: CardPlan,
  notes: readonly string[],
  outcome: 'booked' | 'cancelled',
  because: string,
): Traced<string> {
  const decision = startDecision<string>(`Booking ${instance.name}`, {
    docRef: SHOW_DAY_DOC_REF,
  });
  decision.include('Card plan', plan.planTrace);
  for (const line of notes) {
    decision.note(line);
  }
  return decision.choose(outcome, because);
}

/** Books (or cancels) the computer-run shows the unit has today. */
export function runBookShow(job: AiJobContext): void {
  const shows = job.shows.filter(
    (show) => show.status === 'scheduled' && showControllerOf(job.read, show).kind === 'computer',
  );
  for (const show of shows) {
    const result = job.tx.savepoint(bookShowSavepointLabel(show.id), (tx) => {
      const buffered = bufferedContext({ ...job }, tx);
      const ctx = buffered.context;
      const instance = tx.view.tables.eventInstances.require(show.id);
      const booked = bookOneShow(ctx, instance);
      const planRef: TraceRef = { kind: CARD_PLAN_TRACE_KIND, id: instance.id };
      ctx.recordTrace(planRef, ctx.date, booked.planTrace, { summaryOnly: true });
      let summary: TemplatedText;
      if (booked.outcome.kind === 'booked') {
        tx.update('eventInstances', instance.id, { status: 'booked' });
        ctx.publish('aip.cardBooked', {
          eventInstanceId: instance.id,
          promotionId: instance.promotionId,
          brandId: instance.brandId,
          segmentCount: booked.outcome.segmentCount,
          titleMatchCount: booked.outcome.titleMatchCount,
        });
        summary = {
          key: parseContentKey(CARD_BOOKED_SUMMARY_KEY),
          params: {
            show: instance.name,
            matches: booked.counts.matches,
            talking: booked.counts.talking,
            titles: booked.counts.titles,
          },
        };
      } else {
        cancelShow(ctx, instance, 'byPromotion');
        ctx.log(`Cancelled ${instance.name} (${instance.id}): ${booked.outcome.reason}`);
        summary = {
          key: parseContentKey(SHOW_CANCELLED_SUMMARY_KEY),
          params: { show: instance.name, reason: booked.outcome.reason },
        };
      }
      writeAiDecision(tx, ctx, job.unit, {
        kind: CARD_DECISION_KIND,
        summary,
        refs: { eventInstanceId: instance.id, promotionIds: [instance.promotionId] },
        traceRef: planRef,
        revealOn: instance.airDate,
        importance: booked.outcome.kind === 'cancelled' ? 2 : 1,
      });
      return buffered.flush;
    });
    if (result.ok) {
      result.value();
    } else {
      // A planner bug: the show stays as it was. Published like a failed job so a strict sim run
      // fails on it.
      const message = `${show.id}: ${result.error.message}`.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
      job.log(`${show.name} could not be booked and was left as it was: ${message}`);
      job.publish('aip.jobFailed', {
        jobId: BOOK_SHOW_JOB_ID,
        promotionId: job.unit.promotionId,
        brandId: job.unit.brandId,
        message,
      });
    }
  }
}

registerAiJob({ id: BOOK_SHOW_JOB_ID, cadence: 'beforeShow', run: runBookShow });
