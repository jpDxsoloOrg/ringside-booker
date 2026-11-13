/**
 * Gathers what the venue pick needs for one show from the world and runs it (EVT6-02). The
 * automatic pick (EVT6-03), the rival calendars (AIP7) and tours (EVT8) all call this one function.
 * Design: docs/design/box-office.md#pick.
 */

import type { RegionId } from '../../core/ids';
import type { Traced } from '../../core/trace/types';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Venue } from '../../model/entities/venue';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import { forecastAttendance } from './forecast';
import { pickVenue, type VenueCandidate, type VenueOptionKey } from './formulas/pickVenue';
import { genericVenueSizes } from './genericVenues';
import { venueAvailability, type VenueBooking } from './showVenue';

function candidateOf(
  read: GameWorldView,
  venue: DeepReadonly<Venue>,
  booking: VenueBooking,
): VenueCandidate {
  return {
    venueId: venue.id,
    name: venue.name,
    capacity: venue.capacity,
    regionId: venue.regionId,
    availability: venueAvailability(read, venue, booking),
  };
}

/**
 * Picks a venue for `instance`: forecasts its crowd in its own region, lists the real venues in
 * that region and the rest of its country with whether each can be booked, resolves the preferred
 * venue from its definition, then runs `pickVenue`.
 */
export function pickVenueFor(
  read: GameWorldView,
  tunables: EngineTunables,
  instance: DeepReadonly<EventInstance>,
): Traced<VenueOptionKey> {
  const booking: VenueBooking = {
    promotionId: instance.promotionId,
    date: instance.date,
    eventInstanceId: instance.id,
  };
  const geography = geographyOf(read);
  const region = geography.region(instance.regionId);
  const country = geography.countryOf(instance.regionId);
  const venuesIn = (regionId: RegionId): VenueCandidate[] =>
    read.tables.venues
      .lookup('byRegion', regionId)
      .map((venue) => candidateOf(read, venue, booking));

  const definition =
    instance.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(instance.eventDefinitionId);
  const preferredVenue =
    definition?.preferredVenueId === null || definition?.preferredVenueId === undefined
      ? undefined
      : read.tables.venues.get(definition.preferredVenueId);

  return pickVenue(
    {
      show: {
        promotionId: instance.promotionId,
        date: instance.date,
        regionId: region.id,
        regionName: region.name,
        countryId: country.id,
        countryName: country.name,
      },
      expected: forecastAttendance(read, tunables, instance).expected.value,
      preferred: preferredVenue === undefined ? null : candidateOf(read, preferredVenue, booking),
      inRegion: venuesIn(region.id),
      inCountry: geography
        .regionsOf(country.id)
        .filter((other) => other.id !== region.id)
        .flatMap((other) => venuesIn(other.id)),
      genericSizes: genericVenueSizes(tunables),
    },
    { tunables },
  );
}
