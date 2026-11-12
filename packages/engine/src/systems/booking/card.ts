/**
 * Reading a show's card: the segments on one event instance, in running order.
 *
 * Queries, the show night (EVT3), the results page (EVT8) and the rival booker (AIP4) read cards
 * through these two helpers so they all agree on the order.
 *
 * Design notes: docs/design/booking.md#the-card-model.
 */

import type { EventInstanceId } from '../../core/ids';
import type { Segment } from '../../model/entities/segment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** True when at least one segment is booked on the show. */
export function hasCard(read: GameWorldView, eventInstanceId: EventInstanceId): boolean {
  return read.tables.segments.lookup('byEventInstance', eventInstanceId).length > 0;
}

/**
 * The show's segments in running order: the pre-show first, then the main card, each by slot. Open
 * slots are simply missing from the list.
 */
export function cardSegments(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
): DeepReadonly<Segment>[] {
  return [...read.tables.segments.lookup('byEventInstance', eventInstanceId)].sort(
    (left, right) => Number(right.preShow) - Number(left.preShow) || left.slot - right.slot,
  );
}
