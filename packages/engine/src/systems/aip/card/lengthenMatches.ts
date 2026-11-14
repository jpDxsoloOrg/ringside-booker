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
import type { SegmentId } from '../../../core/ids';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { MatchSegment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
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
function candidatesOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  segmentIds: readonly SegmentId[],
): DeepReadonly<MatchSegment>[] {
  const { slots } = instance.format;
  const found: DeepReadonly<MatchSegment>[] = [];
  for (const segmentId of segmentIds) {
    const segment = read.tables.segments.get(segmentId);
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

/**
 * The matches a rival booker sets to Long on `instance`: none below a major show; otherwise the
 * semi-main first, then down the card, each while the show's spare time covers it.
 */
export function matchesToLengthen(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  segmentIds: readonly SegmentId[],
  tunables: EngineTunables,
): SegmentId[] {
  if (!LENGTHEN_ON.has(instance.importance)) {
    return [];
  }
  const time = showTimeOf(read, instance, tunables);
  let spare = time.budget.value - time.used.value;
  const chosen: SegmentId[] = [];
  for (const segment of candidatesOf(read, instance, segmentIds)) {
    if (spare <= 0) {
      break;
    }
    const role = slotRoleOf(
      { slot: segment.slot + 1, slots: instance.format.slots, preShow: false },
      { tunables },
    ).value;
    const matchType = durationShifterOf(read, segment, tunables);
    const now = durationClassOf({ role, matchType }, { tunables }).value;
    const next = durationClassOf({ role, matchType, booked: 'long' }, { tunables }).value;
    const cost = timeUnitsOf(next, tunables) - timeUnitsOf(now, tunables);
    if (next === now || cost > spare) {
      continue;
    }
    spare -= cost;
    chosen.push(segment.id);
  }
  return chosen;
}

/** The booked-card step: sets the chosen matches to Long. */
export function lengthenMatches(ctx: ShowBookingContext, input: BookedCardInput): void {
  const { instance } = input;
  const chosen = matchesToLengthen(ctx.read, instance, input.segmentIds, ctx.tunables);
  for (const segmentId of chosen) {
    ctx.tx.update('segments', segmentId, (previous) => ({ ...previous, bookedLength: 'long' }));
  }
  if (chosen.length > 0) {
    ctx.log(
      `${instance.name} (${instance.id}): booked ${String(chosen.length)} matches long for a big show`,
    );
  }
}

registerBookedCardStep({
  id: LENGTHEN_MATCHES_STEP_ID,
  order: LENGTHEN_MATCHES_STEP_ORDER,
  run: lengthenMatches,
});
