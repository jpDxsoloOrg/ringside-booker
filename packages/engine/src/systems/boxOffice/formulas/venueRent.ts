/**
 * Venue rent for one show, in cents: a base fee plus rent on every seat of capacity, scaled by the
 * kind of venue, and only a share of that in a venue that belongs to the company.
 *
 * Rent is charged on capacity, not on the crowd: an empty arena costs the same as a full one, which
 * is what makes picking a venue the right size matter. Design: docs/design/box-office.md#venue-rent.
 */

import type { VenueKind } from '../../../model/entities/venue';
import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';

export const VENUE_RENT_DOC_REF = 'box-office.md#venue-rent';

export interface VenueRentInputs {
  readonly capacity: number;
  readonly venueKind: VenueKind;
  readonly venueName: string;
  /** True when the venue is exclusive to the show's own promotion. */
  readonly ownVenue: boolean;
}

const RENT_KIND_KEYS = {
  hall: 'boxOffice.rent.kind.hall',
  theatre: 'boxOffice.rent.kind.theatre',
  arena: 'boxOffice.rent.kind.arena',
  stadium: 'boxOffice.rent.kind.stadium',
  studio: 'boxOffice.rent.kind.studio',
  outdoor: 'boxOffice.rent.kind.outdoor',
} as const satisfies Readonly<Record<VenueKind, NumberTunableKey>>;

const RENT_KIND_LABELS: Readonly<Record<VenueKind, string>> = {
  hall: 'Hall',
  theatre: 'Theatre',
  arena: 'Arena',
  stadium: 'Stadium',
  studio: 'Studio',
  outdoor: 'Outdoor venue',
};

/** The venue's rent for the show in whole cents, 0 or more. Deterministic: no rolls. */
export function computeVenueRent(
  inputs: VenueRentInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Venue rent',
    inputOf(`Capacity of ${inputs.venueName}`, inputs.capacity, undefined, 'count'),
    { unit: 'money', docRef: VENUE_RENT_DOC_REF },
  );
  calc.multiply('Rent per seat', calc.tunable(tunables, 'boxOffice.rent.perSeat', 'Rent per seat'));
  calc.multiply(
    RENT_KIND_LABELS[inputs.venueKind],
    calc.tunable(tunables, RENT_KIND_KEYS[inputs.venueKind], 'Kind of venue'),
  );
  calc.add('Base rent', calc.tunable(tunables, 'boxOffice.rent.base', 'Base rent'));
  calc.branch('Your own venue', inputs.ownVenue);
  if (inputs.ownVenue) {
    calc.multiply(
      'Your own venue',
      calc.tunable(tunables, 'boxOffice.rent.ownVenueFactor', 'Share of the rent you pay'),
    );
  }
  calc.round('round', 'Rounded to whole cents');
  return calc.done();
}
