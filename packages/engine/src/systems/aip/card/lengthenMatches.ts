/**
 * EVT4-08: rival bookers lengthen their big matches on big shows.
 *
 * A booked-card step: on a major or flagship rival show, once the card is written, the booker spends
 * the show's spare time (`match.showTime`) setting matches to Long, the semi-main first and then
 * down the card. It never goes over the show's time, never touches the main event (always long) or
 * the pre-show, and leaves weekly and smaller shows at their usual times. A longer match raises the
 * star limit and the crowd's expectation, the same gamble the player takes.
 *
 * Design: docs/design/match-rating.md#show-time and docs/design/rival-booking.md#show-day.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import type { MatchSegment } from '../../../model/entities/segment';
import { durationShifterOf, showTimeOf, timeUnitsOf } from '../../match/showTime';
import { durationClassOf, slotRoleOf } from '../../match/slots';
import {
  registerBookedCardStep,
  type BookedCardInput,
  type ShowBookingContext,
} from './bookedCardSteps';

export const LENGTHEN_MATCHES_STEP_ID = 'aip.lengthenMatches';
/** Before the winners are decided (`aip.decideResults`, order 10). */
export const LENGTHEN_MATCHES_STEP_ORDER = 5;

/** The show sizes on which a rival booker lengthens matches. */
export const LENGTHEN_ON: ReadonlySet<EventImportance> = new Set(['major', 'flagship']);

/** The match segments a booker may lengthen, the top of the card first. */
function candidatesOf(ctx: ShowBookingContext, input: BookedCardInput): MatchSegment[] {
  const { slots } = input.instance.format;
  const found: MatchSegment[] = [];
  for (const segmentId of input.segmentIds) {
    const segment = ctx.read.tables.segments.get(segmentId);
    if (
      segment?.kind === 'match' &&
      !segment.preShow &&
      segment.slot < slots - 1 &&
      segment.bookedLength === undefined
    ) {
      found.push(segment);
    }
  }
  return found.sort((left, right) => right.slot - left.slot);
}

/** Sets the show's big matches to Long while the show has time to spare. */
export function lengthenMatches(ctx: ShowBookingContext, input: BookedCardInput): void {
  const { instance } = input;
  if (!LENGTHEN_ON.has(instance.importance)) {
    return;
  }
  const { tunables } = ctx;
  const time = showTimeOf(ctx.read, instance, tunables);
  let spare = time.budget.value - time.used.value;
  const lengthened: number[] = [];
  for (const segment of candidatesOf(ctx, input)) {
    if (spare <= 0) {
      break;
    }
    const role = slotRoleOf(
      { slot: segment.slot + 1, slots: instance.format.slots, preShow: false },
      { tunables },
    ).value;
    const matchType = durationShifterOf(ctx.read, segment, tunables);
    const now = durationClassOf({ role, matchType }, { tunables }).value;
    const next = durationClassOf({ role, matchType, booked: 'long' }, { tunables }).value;
    const cost = timeUnitsOf(next, tunables) - timeUnitsOf(now, tunables);
    if (next === now || cost > spare) {
      continue;
    }
    ctx.tx.update('segments', segment.id, (previous) => ({ ...previous, bookedLength: 'long' }));
    spare -= cost;
    lengthened.push(segment.slot + 1);
  }
  if (lengthened.length > 0) {
    ctx.log(
      `${instance.name} (${instance.id}): booked slots ${lengthened.join(', ')} long for a big show`,
    );
  }
}

registerBookedCardStep({
  id: LENGTHEN_MATCHES_STEP_ID,
  order: LENGTHEN_MATCHES_STEP_ORDER,
  run: lengthenMatches,
});
