/**
 * Where a show is held, in one shape whether it is a real venue or a generic local one (EVT6-02),
 * and whether a real venue can be booked for a show. Screens and formulas read venues through
 * here. Design: docs/design/box-office.md#venues.
 */

import type { GameDate } from '../../core/date';
import type { EventInstanceId, PromotionId, RegionId, VenueId } from '../../core/ids';
import type { EventInstance } from '../../model/entities/event-instance';
import {
  isVenueOpenOn,
  type GenericVenueTier,
  type Venue,
  type VenueKind,
} from '../../model/entities/venue';
import type { ImageRef } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { GENERIC_VENUE_IMAGE_REF, GENERIC_VENUE_KINDS, genericVenueName } from './genericVenues';

/** A show's venue: a real one from the `venues` table, or a generic local one. */
export type ShowVenue =
  | {
      readonly kind: 'venue';
      readonly venueId: VenueId;
      readonly name: string;
      readonly capacity: number;
      readonly venueKind: VenueKind;
      readonly regionId: RegionId;
      readonly imageRef: ImageRef;
      readonly exclusivePromotionId: PromotionId | null;
    }
  | {
      readonly kind: 'generic';
      readonly tier: GenericVenueTier;
      /** "Local hall, Northeast". */
      readonly name: string;
      readonly capacity: number;
      readonly venueKind: VenueKind;
      readonly regionId: RegionId;
      readonly imageRef: typeof GENERIC_VENUE_IMAGE_REF;
    };

/** The show's venue, or null while none is chosen (or its venue row is missing). */
export function showVenueOf(
  read: GameWorldView,
  instance: DeepReadonly<Pick<EventInstance, 'venueId' | 'genericVenue' | 'regionId'>>,
): ShowVenue | null {
  if (instance.venueId !== null) {
    const venue = read.tables.venues.get(instance.venueId);
    if (venue === undefined) {
      return null;
    }
    return {
      kind: 'venue',
      venueId: venue.id,
      name: venue.name,
      capacity: venue.capacity,
      venueKind: venue.kind,
      regionId: venue.regionId,
      imageRef: venue.imageRef,
      exclusivePromotionId: venue.exclusivePromotionId,
    };
  }
  if (instance.genericVenue !== null) {
    const { tier, capacity } = instance.genericVenue;
    const regionName = read.tables.regions.get(instance.regionId)?.name ?? instance.regionId;
    return {
      kind: 'generic',
      tier,
      name: genericVenueName(tier, regionName),
      capacity,
      venueKind: GENERIC_VENUE_KINDS[tier],
      regionId: instance.regionId,
      imageRef: GENERIC_VENUE_IMAGE_REF,
    };
  }
  return null;
}

/** Why a real venue cannot be booked for a show. */
export const VENUE_UNAVAILABLE_CODES = [
  'boxOffice.venueClosed',
  'boxOffice.venueExclusive',
  'boxOffice.venueTaken',
] as const;
export type VenueUnavailableCode = (typeof VENUE_UNAVAILABLE_CODES)[number];

export type VenueAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly code: VenueUnavailableCode; readonly message: string };

/** The show a venue would be booked for. */
export interface VenueBooking {
  readonly promotionId: PromotionId;
  readonly date: GameDate;
  /** The show itself, so its own booking of the venue never counts as taken. */
  readonly eventInstanceId: EventInstanceId | null;
}

/**
 * Whether `venue` can be booked for a show of `booking.promotionId` on `booking.date`. In order:
 * it must be open that day, not exclusive to another promotion (a venue exclusive to the show's own
 * promotion is fine) and not used that night by another promotion's show that is not cancelled.
 */
export function venueAvailability(
  read: GameWorldView,
  venue: DeepReadonly<Pick<Venue, 'id' | 'openedOn' | 'closedOn' | 'exclusivePromotionId'>>,
  booking: VenueBooking,
): VenueAvailability {
  if (!isVenueOpenOn(venue, booking.date)) {
    return { available: false, code: 'boxOffice.venueClosed', message: 'Closed on that date' };
  }
  if (venue.exclusivePromotionId !== null && venue.exclusivePromotionId !== booking.promotionId) {
    const owner = read.tables.promotions.get(venue.exclusivePromotionId);
    return {
      available: false,
      code: 'boxOffice.venueExclusive',
      message: `Exclusive to ${owner?.name ?? 'another promotion'}`,
    };
  }
  const taken = read.tables.eventInstances
    .lookup('byDate', booking.date)
    .find(
      (show) =>
        show.venueId === venue.id &&
        show.id !== booking.eventInstanceId &&
        show.promotionId !== booking.promotionId &&
        show.status !== 'cancelled',
    );
  if (taken !== undefined) {
    const rival = read.tables.promotions.get(taken.promotionId);
    return {
      available: false,
      code: 'boxOffice.venueTaken',
      message: `${rival?.name ?? 'Another promotion'} runs ${taken.name} there that night`,
    };
  }
  return { available: true };
}
