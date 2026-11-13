/**
 * Generic local venues (EVT6-02): a set of sizes, from a small room to a stadium, that every region
 * has. A show with no suitable real venue is held in one; the size and the capacity it had when it
 * was chosen are stored on the show (`eventInstances.genericVenue`).
 *
 * Capacities are tunables, so the order of the sizes is worked out from them every time they are
 * read: an override that makes a "hall" bigger than a "large hall" still picks the smallest one
 * that fits. Design: docs/design/box-office.md#generic-venues.
 */

import {
  GENERIC_VENUE_TIERS,
  type GenericVenueTier,
  type VenueKind,
} from '../../model/entities/venue';
import type { EngineTunables } from '../tunables';

export { GENERIC_VENUE_TIERS, type GenericVenueTier };
export type { GenericVenue } from '../../model/entities/event-instance';

const GENERIC_VENUE_LABELS: Readonly<Record<GenericVenueTier, string>> = {
  room: 'Local room',
  smallHall: 'Local small hall',
  hall: 'Local hall',
  largeHall: 'Local large hall',
  smallArena: 'Local small arena',
  arena: 'Local arena',
  largeArena: 'Local large arena',
  stadium: 'Local stadium',
};

/** The kind of building each size rents as, for rent and the screens. */
export const GENERIC_VENUE_KINDS: Readonly<Record<GenericVenueTier, VenueKind>> = {
  room: 'hall',
  smallHall: 'hall',
  hall: 'hall',
  largeHall: 'hall',
  smallArena: 'arena',
  arena: 'arena',
  largeArena: 'arena',
  stadium: 'stadium',
};

/** The image every generic venue shows until it has art of its own. */
export const GENERIC_VENUE_IMAGE_REF = 'placeholder:venue';

/** "Local hall". */
export function genericVenueLabel(tier: GenericVenueTier): string {
  return GENERIC_VENUE_LABELS[tier];
}

/** "Local hall, Northeast": a generic venue's name in a region. */
export function genericVenueName(tier: GenericVenueTier, regionName: string): string {
  return `${genericVenueLabel(tier)}, ${regionName}`;
}

/** The tunable that holds a size's capacity. */
export function genericCapacityKey(
  tier: GenericVenueTier,
): `boxOffice.generic.${GenericVenueTier}.capacity` {
  return `boxOffice.generic.${tier}.capacity`;
}

export interface GenericVenueSize {
  readonly tier: GenericVenueTier;
  readonly capacity: number;
}

/**
 * Every size with its capacity from `tunables`, smallest first. Equal capacities keep the order of
 * `GENERIC_VENUE_TIERS`.
 */
export function genericVenueSizes(tunables: EngineTunables): readonly GenericVenueSize[] {
  return GENERIC_VENUE_TIERS.map((tier, order) => ({
    tier,
    capacity: tunables.get(genericCapacityKey(tier)),
    order,
  }))
    .sort((left, right) => left.capacity - right.capacity || left.order - right.order)
    .map(({ tier, capacity }) => ({ tier, capacity }));
}
