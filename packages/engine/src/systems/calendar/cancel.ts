/**
 * Cancelling a show: the one write both ways of cancelling share.
 *
 * The row is kept, never deleted. Its place in the unique `byDefinitionAirDate` index stays taken,
 * which is what stops the daily horizon from scheduling the same show again.
 *
 * Design notes: docs/design/calendar.md#lifecycle.
 */

import type { PhaseContext } from '../../core/pipeline/context';
import type { CancellationReason, EventInstance } from '../../model/entities/event-instance';
import type { DeepReadonly } from '../../model/world';

/**
 * Marks `show` cancelled today for `reason` and publishes `show.cancelled`. The show's segments
 * are left as they are.
 */
export function cancelShow(
  ctx: PhaseContext,
  show: DeepReadonly<Pick<EventInstance, 'id' | 'promotionId' | 'date'>>,
  reason: CancellationReason,
): void {
  ctx.tx.update('eventInstances', show.id, {
    status: 'cancelled',
    cancellation: { reason, on: ctx.date },
  });
  ctx.publish('show.cancelled', {
    eventInstanceId: show.id,
    promotionId: show.promotionId,
    date: show.date,
    reason,
  });
}
