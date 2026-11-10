// Where a scheduled show is held. Design: docs/design/calendar.md#placement
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import type { EventDefinition } from '../../../src/model/entities/event-definition';
import type { Venue } from '../../../src/model/entities/venue';
import type { GameWorld } from '../../../src/model/tables';
import { placeShow, PLACEMENT_RULES } from '../../../src/systems/calendar';
import {
  anEventDefinition,
  aPromotion,
  aVenue,
  worldBuilder,
  type DeepPartial,
  type WorldIds,
} from '../../support';
import { expectSerialisable, expectTraceContains } from '../../support/trace';

const SHOW_DATE = parseGameDate('2026-03-02');

interface PlacementWorld {
  world: GameWorld;
  ids: WorldIds;
  venue: Venue;
}

/**
 * Two promotions (A is home in region 1, B in region 2) and one venue in region 3, built from
 * `venueOverrides`. `exclusiveTo` binds the venue to one of them.
 */
function placementWorld(
  venueOverrides: DeepPartial<Venue> = {},
  exclusiveTo: 'A' | 'B' | null = null,
): PlacementWorld {
  let venue: Venue | undefined;
  const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
    .withGeography('mini')
    .withPromotion()
    .with('a second promotion and a venue', (context) => {
      const [, secondRegionId, thirdRegionId] = context.ids.regions;
      if (secondRegionId === undefined || thirdRegionId === undefined) {
        throw new Error('the mini geography should have four regions');
      }
      context.insert('promotions', aPromotion({ homeRegionId: secondRegionId }, context.sequence));
      const exclusivePromotionId =
        exclusiveTo === null ? null : (context.ids.promotions[exclusiveTo] ?? null);
      venue = context.insert(
        'venues',
        aVenue(
          { regionId: thirdRegionId, exclusivePromotionId, ...venueOverrides },
          context.sequence,
        ),
      );
    })
    .build();
  if (venue === undefined) {
    throw new Error('the venue should have been inserted');
  }
  return { world, ids, venue };
}

function must<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

function definitionFor(
  built: PlacementWorld,
  overrides: DeepPartial<EventDefinition> = {},
): EventDefinition {
  return anEventDefinition({ promotionId: must(built.ids.promotions.A), ...overrides });
}

function ruleValue(result: ReturnType<typeof placeShow>, label: string): unknown {
  return expectTraceContains(result, { kind: 'branch', label }).value;
}

describe('placeShow', () => {
  it('uses the preferred venue when it is open and free to book', () => {
    const built = placementWorld();
    const result = placeShow(
      built.world,
      definitionFor(built, { preferredVenueId: built.venue.id }),
      SHOW_DATE,
    );
    expect(result.value).toEqual({ regionId: built.venue.regionId, venueId: built.venue.id });
    expect(result.trace).toMatchObject({
      kind: 'decision',
      chosen: 'preferredVenue',
      docRef: 'calendar.md#placement',
    });
    expect(ruleValue(result, PLACEMENT_RULES.hasPreferredVenue)).toBe(true);
    expect(ruleValue(result, PLACEMENT_RULES.venueOpen)).toBe(true);
    expect(ruleValue(result, PLACEMENT_RULES.venueBookable)).toBe(true);
    expectSerialisable(result);
  });

  it("uses a venue that is exclusive to the show's own promotion", () => {
    const built = placementWorld({}, 'A');
    const result = placeShow(
      built.world,
      definitionFor(built, { preferredVenueId: built.venue.id }),
      SHOW_DATE,
    );
    expect(result.value.venueId).toBe(built.venue.id);
    expect(ruleValue(result, PLACEMENT_RULES.venueBookable)).toBe(true);
  });

  it.each([
    [
      'closed before the show',
      { closedOn: parseGameDate('2026-03-01') },
      null,
      PLACEMENT_RULES.venueOpen,
    ],
    ['closing on the day of the show', { closedOn: SHOW_DATE }, null, PLACEMENT_RULES.venueOpen],
    ['not open yet', { openedOn: parseGameDate('2026-03-03') }, null, PLACEMENT_RULES.venueOpen],
    ['exclusive to another promotion', {}, 'B', PLACEMENT_RULES.venueBookable],
  ] as const)(
    'leaves the venue unchosen when it is %s',
    (_name, venueOverrides, exclusiveTo, failedRule) => {
      const built = placementWorld(venueOverrides, exclusiveTo);
      const result = placeShow(
        built.world,
        definitionFor(built, { preferredVenueId: built.venue.id }),
        SHOW_DATE,
      );
      expect(result.value.venueId).toBeNull();
      expect(result.trace).toMatchObject({ kind: 'decision', chosen: 'notChosen' });
      expect(ruleValue(result, PLACEMENT_RULES.hasPreferredVenue)).toBe(true);
      for (const rule of [PLACEMENT_RULES.venueOpen, PLACEMENT_RULES.venueBookable]) {
        expect(ruleValue(result, rule), rule).toBe(rule !== failedRule);
      }
      // With no usable venue and no preferred region, the show falls back to the home region.
      expect(result.value.regionId).toBe(built.ids.regions[0]);
      expectSerialisable(result);
    },
  );

  it('uses a venue that opens on the day of the show', () => {
    const built = placementWorld({ openedOn: SHOW_DATE });
    const result = placeShow(
      built.world,
      definitionFor(built, { preferredVenueId: built.venue.id }),
      SHOW_DATE,
    );
    expect(result.value.venueId).toBe(built.venue.id);
  });

  it('leaves the venue unchosen when the show has no preferred venue', () => {
    const built = placementWorld();
    const result = placeShow(built.world, definitionFor(built), SHOW_DATE);
    expect(result.value.venueId).toBeNull();
    expect(ruleValue(result, PLACEMENT_RULES.hasPreferredVenue)).toBe(false);
    expect(result.trace).toMatchObject({ chosen: 'notChosen' });
  });

  it('picks the region in order: preferred region, venue region, home region', () => {
    const built = placementWorld();
    const [homeRegionId, , venueRegionId] = built.ids.regions;
    const preferredRegionId = must(built.ids.regions[3]);
    expect(built.venue.regionId).toBe(venueRegionId);

    const preferred = placeShow(
      built.world,
      definitionFor(built, { preferredRegionId, preferredVenueId: built.venue.id }),
      SHOW_DATE,
    );
    expect(preferred.value).toEqual({ regionId: preferredRegionId, venueId: built.venue.id });
    expect(ruleValue(preferred, PLACEMENT_RULES.hasPreferredRegion)).toBe(true);

    const fromVenue = placeShow(
      built.world,
      definitionFor(built, { preferredVenueId: built.venue.id }),
      SHOW_DATE,
    );
    expect(fromVenue.value.regionId).toBe(venueRegionId);
    expect(ruleValue(fromVenue, PLACEMENT_RULES.hasPreferredRegion)).toBe(false);
    expect(ruleValue(fromVenue, PLACEMENT_RULES.regionFromVenue)).toBe(true);

    const home = placeShow(built.world, definitionFor(built), SHOW_DATE);
    expect(home.value.regionId).toBe(homeRegionId);
    expect(ruleValue(home, PLACEMENT_RULES.regionFromVenue)).toBe(false);
    expectTraceContains(home, { kind: 'note', label: /home region/ });
    expectSerialisable(home);
  });

  it('gives the same placement and trace every time', () => {
    const built = placementWorld();
    const definition = definitionFor(built, { preferredVenueId: built.venue.id });
    expect(placeShow(built.world, definition, SHOW_DATE)).toEqual(
      placeShow(built.world, definition, SHOW_DATE),
    );
  });
});
