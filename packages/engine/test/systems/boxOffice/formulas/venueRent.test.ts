// Venue rent. Design: docs/design/box-office.md#venue-rent
import { describe, expect, it } from 'vitest';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import { VENUE_KINDS, type VenueKind } from '../../../../src/model/entities/venue';
import { computeVenueRent, type VenueRentInputs } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function rent(
  overrides: Partial<VenueRentInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeVenueRent(
    { capacity: 1000, venueKind: 'hall', venueName: 'Hall', ownVenue: false, ...overrides },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeVenueRent', () => {
  it('is the base rent plus rent per seat of capacity', () => {
    expect(rent().value).toBe(25_000 + 350 * 1000);
  });

  it('charges the base rent for a venue with no seats', () => {
    expect(rent({ capacity: 0 }).value).toBe(25_000);
  });

  it('scales the seat rent by the kind of venue', () => {
    const factors: Readonly<Record<VenueKind, number>> = {
      hall: 1,
      theatre: 1.1,
      arena: 1.25,
      stadium: 3.5,
      studio: 0.6,
      outdoor: 1.2,
    };
    for (const venueKind of VENUE_KINDS) {
      expect(rent({ venueKind }).value).toBe(Math.round(25_000 + 350 * 1000 * factors[venueKind]));
    }
  });

  it('charges a quarter of the rent in your own venue', () => {
    const own = rent({ ownVenue: true });
    expect(own.value).toBe(Math.round((25_000 + 350_000) * 0.25));
    expect(findTraceNodes(own.trace, 'branch')[0]?.taken).toBe(true);
    const theirs = rent();
    expect(findTraceNodes(theirs.trace, 'branch')[0]?.taken).toBe(false);
    expect(findTraceNodes(theirs.trace, 'multiply').map((node) => node.label)).not.toContain(
      'Your own venue',
    );
  });

  it('treats 0 as 0 for every tunable', () => {
    expect(rent({}, createEngineTunables({ 'boxOffice.rent.perSeat': 0 })).value).toBe(25_000);
    expect(rent({}, createEngineTunables({ 'boxOffice.rent.base': 0 })).value).toBe(350_000);
    expect(rent({}, createEngineTunables({ 'boxOffice.rent.kind.hall': 0 })).value).toBe(25_000);
    expect(
      rent({ ownVenue: true }, createEngineTunables({ 'boxOffice.rent.ownVenueFactor': 0 })).value,
    ).toBe(0);
  });

  it('reaches the most the tunables allow', () => {
    const tunables = createEngineTunables({
      'boxOffice.rent.base': 10_000_000,
      'boxOffice.rent.perSeat': 100_000,
      'boxOffice.rent.kind.stadium': 5,
    });
    expect(rent({ capacity: 200_000, venueKind: 'stadium' }, tunables).value).toBe(
      10_000_000 + 100_000 * 200_000 * 5,
    );
  });
});
