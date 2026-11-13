/**
 * Storing a show's venue (EVT6-02): the one write both the automatic pick and the player's Change
 * venue share. Design: docs/design/box-office.md#venues.
 */

import type { EventInstanceId, VenueId } from '../../core/ids';
import { EntityNotFoundError, InvalidArgumentError } from '../../core/errors';
import type { StepContext } from '../../core/pipeline/context';
import type { Traced } from '../../core/trace/types';
import { genericCapacityKey } from './genericVenues';
import { genericTierOf, isGenericOptionKey, type VenueOptionKey } from './formulas/pickVenue';
import { venuePickTraceRef } from './traceKinds';

export interface ApplyVenueOptions {
  /** True when the game picked the venue, false when the player chose it. */
  readonly auto: boolean;
  /** The pick's Why?, stored under `boxOffice.venuePick` when given. */
  readonly trace?: Traced<VenueOptionKey>;
}

/**
 * Gives the show `choice`. A real venue sets `venueId`, clears `genericVenue` and moves the show to
 * the venue's region (a show is held where its venue is). A generic size clears `venueId` and
 * stores the size with its capacity today, so a later tunable change never rewrites the show.
 * Publishes `show.venueChosen`.
 */
export function applyVenueChoice(
  ctx: StepContext,
  eventInstanceId: EventInstanceId,
  choice: VenueOptionKey,
  options: ApplyVenueOptions,
): void {
  const instance = ctx.read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    throw new EntityNotFoundError('eventInstances', eventInstanceId);
  }
  const tier = genericTierOf(choice);
  let venueId: VenueId | null = null;
  if (!isGenericOptionKey(choice)) {
    const venue = ctx.read.tables.venues.get(choice);
    if (venue === undefined) {
      throw new InvalidArgumentError('applyVenueChoice', 'choice', choice, 'a venue in the world');
    }
    venueId = venue.id;
    ctx.tx.update('eventInstances', eventInstanceId, {
      venueId,
      genericVenue: null,
      regionId: venue.regionId,
    });
  } else if (tier !== null) {
    ctx.tx.update('eventInstances', eventInstanceId, {
      venueId: null,
      genericVenue: { tier, capacity: ctx.tunables.get(genericCapacityKey(tier)) },
    });
  }
  if (options.trace !== undefined) {
    ctx.recordTrace(venuePickTraceRef(eventInstanceId), ctx.date, options.trace);
  }
  ctx.publish('show.venueChosen', {
    eventInstanceId,
    promotionId: instance.promotionId,
    venueId,
    genericTier: tier,
    auto: options.auto,
  });
}
