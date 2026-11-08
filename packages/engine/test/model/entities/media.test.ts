import { describe, expect, it } from 'vitest';
import { cents } from '../../../src/core/money';
import { DealSchema } from '../../../src/model/entities/deal';
import { coveredRegionIds, NetworkSchema } from '../../../src/model/entities/network';
import { isVenueOpenOn, VenueSchema } from '../../../src/model/entities/venue';
import { checkWorld } from '../../../src/model/integrity';
import {
  date,
  emptyGeoMediaWorld,
  GEO_MEDIA_REGISTRY,
  makeContinent,
  makeCountry,
  makeDeal,
  makeNetwork,
  makeRegion,
  makeVenue,
  testId,
} from '../../support/geo-media-fixtures';

/**
 * Two continents. Continent 1 has countries 1 and 2 with regions 1-3 (country 1) and 4 (country
 * 2); continent 2 has country 3 with regions 5 and 6. Promotion 1 is active, promotion 2 closed.
 */
function mediaWorld() {
  const world = emptyGeoMediaWorld();
  world.tables.continents._put(makeContinent(1, { code: 'EU' }));
  world.tables.continents._put(makeContinent(2, { code: 'AS' }));
  world.tables.countries._put(makeCountry(1, { code: 'AAA' }));
  world.tables.countries._put(makeCountry(2, { code: 'BBB' }));
  world.tables.countries._put(makeCountry(3, { code: 'CCC', continentId: testId('continent', 2) }));
  // Inserted out of order on purpose: results must come back in ID order.
  for (const [serial, country] of [
    [6, 3],
    [3, 1],
    [1, 1],
    [4, 2],
    [2, 1],
    [5, 3],
  ] as const) {
    world.tables.regions._put(makeRegion(serial, { countryId: testId('country', country) }));
  }
  world.tables.promotions._put({ id: testId('promotion', 1), status: 'active' });
  world.tables.promotions._put({ id: testId('promotion', 2), status: 'closed' });
  world.tables.eventDefinitions._put({
    id: testId('eventDefinition', 1),
    promotionId: testId('promotion', 1),
  });
  world.tables.eventDefinitions._put({
    id: testId('eventDefinition', 2),
    promotionId: testId('promotion', 2),
  });
  return world;
}

describe('network schema', () => {
  it('accepts a valid network', () => {
    expect(NetworkSchema.safeParse(makeNetwork(1)).success).toBe(true);
  });

  it('rejects a network with all-empty coverage', () => {
    const result = NetworkSchema.safeParse(
      makeNetwork(1, { coverage: { continentIds: [], countryIds: [], regionIds: [] } }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['coverage']);
  });

  it('rejects a coverage list with a duplicate', () => {
    const result = NetworkSchema.safeParse(
      makeNetwork(1, {
        coverage: {
          continentIds: [],
          countryIds: [],
          regionIds: [testId('region', 1), testId('region', 1)],
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['coverage', 'regionIds', 1]);
  });

  it('rejects a reach tier outside 0-4 and a closing date before launch', () => {
    expect(NetworkSchema.safeParse(makeNetwork(1, { reachTier: 5 })).success).toBe(false);
    expect(NetworkSchema.safeParse(makeNetwork(1, { closedOn: date('1999-12-31') })).success).toBe(
      false,
    );
  });
});

describe('coveredRegionIds', () => {
  it('expands a continent to all its regions plus an extra region, in ID order, once each', () => {
    const world = mediaWorld();
    const network = makeNetwork(1, {
      coverage: {
        continentIds: [testId('continent', 1)],
        countryIds: [testId('country', 2)],
        regionIds: [testId('region', 6), testId('region', 2)],
      },
    });
    expect(coveredRegionIds(network, world)).toEqual([
      testId('region', 1),
      testId('region', 2),
      testId('region', 3),
      testId('region', 4),
      testId('region', 6),
    ]);
  });

  it('expands a single country and leaves out regions that do not exist', () => {
    const world = mediaWorld();
    const network = makeNetwork(1, {
      coverage: {
        continentIds: [],
        countryIds: [testId('country', 3)],
        regionIds: [testId('region', 99)],
      },
    });
    expect(coveredRegionIds(network, world)).toEqual([testId('region', 5), testId('region', 6)]);
  });
});

describe('deal schema', () => {
  it('accepts a valid deal', () => {
    expect(DealSchema.safeParse(makeDeal(1)).success).toBe(true);
  });

  it('rejects endsOn equal to startsOn', () => {
    const result = DealSchema.safeParse(
      makeDeal(1, { startsOn: date('2026-04-01'), endsOn: date('2026-04-01') }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endsOn']);
  });

  it('rejects negative terms and a weekday outside 0-6', () => {
    const negativeFee = makeDeal(1, {
      terms: { feePerShow: cents(-1), perThousandViewers: cents(0), costPerShow: cents(0) },
    });
    expect(DealSchema.safeParse(negativeFee).success).toBe(false);
    expect(DealSchema.safeParse({ ...makeDeal(1), weekday: 7 }).success).toBe(false);
  });
});

describe('deal integrity', () => {
  it("a deal for the promotion's own show on an active network passes", () => {
    const world = mediaWorld();
    world.tables.networks._put(makeNetwork(1));
    world.tables.deals._put(makeDeal(1, { eventDefinitionId: testId('eventDefinition', 1) }));
    const report = checkWorld(world, GEO_MEDIA_REGISTRY, { validateRows: true });
    expect(report.issues).toEqual([]);
  });

  it("reports a deal for another promotion's show", () => {
    const world = mediaWorld();
    world.tables.networks._put(makeNetwork(1));
    world.tables.deals._put(makeDeal(1, { eventDefinitionId: testId('eventDefinition', 2) }));
    expect(checkWorld(world, GEO_MEDIA_REGISTRY).issues).toEqual([
      expect.objectContaining({
        code: 'deal.eventDefinitionNotOwned',
        id: testId('deal', 1),
        path: 'eventDefinitionId',
      }),
    ]);
  });

  it('reports an active deal on a closed network but not an expired one', () => {
    const world = mediaWorld();
    world.tables.networks._put(makeNetwork(1, { status: 'closed', closedOn: date('2026-03-01') }));
    world.tables.deals._put(makeDeal(1));
    world.tables.deals._put(makeDeal(2, { status: 'expired' }));
    expect(checkWorld(world, GEO_MEDIA_REGISTRY).issues).toEqual([
      expect.objectContaining({ code: 'deal.networkNotActive', id: testId('deal', 1) }),
    ]);
  });

  it('indexes deals by promotion and by network', () => {
    const world = mediaWorld();
    world.tables.deals._put(makeDeal(1));
    world.tables.deals._put(makeDeal(2, { networkId: testId('network', 2) }));
    expect(world.tables.deals.lookup('byPromotion', testId('promotion', 1))).toHaveLength(2);
    expect(
      world.tables.deals.lookup('byNetwork', testId('network', 2)).map((deal) => deal.id),
    ).toEqual([testId('deal', 2)]);
  });
});

describe('venues', () => {
  it('accepts a valid venue and rejects a bad capacity or closing date', () => {
    expect(VenueSchema.safeParse(makeVenue(1)).success).toBe(true);
    expect(VenueSchema.safeParse(makeVenue(1, { capacity: 0 })).success).toBe(false);
    expect(VenueSchema.safeParse(makeVenue(1, { capacity: 200_001 })).success).toBe(false);
    const closedBeforeOpening = makeVenue(1, {
      openedOn: date('2020-01-01'),
      closedOn: date('2020-01-01'),
    });
    expect(VenueSchema.safeParse(closedBeforeOpening).success).toBe(false);
  });

  it('isVenueOpenOn honours both ends', () => {
    const venue = makeVenue(1, { openedOn: date('2020-01-01'), closedOn: date('2026-01-01') });
    expect(isVenueOpenOn(venue, date('2019-12-31'))).toBe(false);
    expect(isVenueOpenOn(venue, date('2020-01-01'))).toBe(true);
    expect(isVenueOpenOn(venue, date('2025-12-31'))).toBe(true);
    expect(isVenueOpenOn(venue, date('2026-01-01'))).toBe(false);
  });

  it('warns about an open venue exclusive to a closed promotion without failing the report', () => {
    const world = mediaWorld();
    world.tables.venues._put(makeVenue(1, { exclusivePromotionId: testId('promotion', 2) }));
    world.tables.venues._put(makeVenue(2, { exclusivePromotionId: testId('promotion', 1) }));
    world.tables.venues._put(
      makeVenue(3, {
        exclusivePromotionId: testId('promotion', 2),
        openedOn: date('2000-01-01'),
        closedOn: date('2026-01-01'),
      }),
    );
    const report = checkWorld(world, GEO_MEDIA_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'venue.exclusiveClosed',
        severity: 'warning',
        id: testId('venue', 1),
      }),
    ]);
    expect(report.ok).toBe(true);
  });

  it('indexes venues by region', () => {
    const world = mediaWorld();
    world.tables.venues._put(makeVenue(1));
    world.tables.venues._put(makeVenue(2, { regionId: testId('region', 2) }));
    expect(
      world.tables.venues.lookup('byRegion', testId('region', 2)).map((venue) => venue.id),
    ).toEqual([testId('venue', 2)]);
  });
});
