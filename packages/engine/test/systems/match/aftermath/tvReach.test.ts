// TV reach for worker popularity (MTCH3-05): a televised match spreads its competitors' popularity
// into the regions EVT5's TV deals cover, at EVT5's TV weight × `match.popularity.tvSpill`.
// Design: docs/design/match-aftermath.md#integrations
import { describe, expect, it } from 'vitest';
import type { DeepPartial } from '../../../support/builders/build-row';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { anEventDefinition, anEventInstance } from '../../../support/builders/creative';
import { aDeal, aNetwork } from '../../../support/builders/media';
import { testId } from '../../../support/ids';
import { worldBuilder } from '../../../support/world-builder';
import type { PersonId, RegionId } from '../../../../src/core/ids';
import type { Deal } from '../../../../src/model/entities/deal';
import type { GameWorld } from '../../../../src/model/tables';
import {
  computeSegmentAftermath,
  listPopularityReach,
  registerPopularityReach,
  segmentRegionWeights,
  TV_REACH_PROVIDER_ID,
  tvReachRegions,
  type ReachContext,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { geographyOf } from '../../../../src/systems/world/geography';
import { RegistryError } from '../../../../src/core/errors';
import { applyInOrder, NORTH_1, NORTH_2, REGIONS, SHOW_DATE, SOUTH_1, SOUTH_2 } from './fixtures';

const SOUTH = testId('country', 2);
const NETWORK_NAME = 'Southern Signal';
/** EVT5's TV weight for reach tier 2 (`promoPop.tvReach.tier2`). */
const TIER_2_WEIGHT = 0.3;
const TV_SPILL = 0.3;

function everywhere(value: number): Record<RegionId, number> {
  return Object.fromEntries(REGIONS.map((region) => [region, value]));
}

interface TvWorldOptions {
  /** The show's definition is televised. True by default. */
  readonly televised?: boolean;
  /** The TV deal, or null for none. A deal for the show's definition by default. */
  readonly deal?: DeepPartial<Deal> | null;
}

/**
 * A human promotion with two wrestlers (charisma 90, popularity 40 everywhere) and a completed
 * show in North 1 (neighbour: North 2 only) where wrestler 0 beats wrestler 1. A tier 2 network
 * covers the South country (South 1 and South 2), which no neighbour reaches.
 */
function tvWorld(options: TvWorldOptions = {}) {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(2, {
        person: () => ({ attributes: { charisma: 90 }, regionalPop: everywhere(40) }),
        employment: () => ({ momentum: 0 }),
      }),
    )
    .with('televised show', (context) => {
      const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
      const definition = context.insert(
        'eventDefinitions',
        anEventDefinition({ promotionId, televised: options.televised ?? true }, context.sequence),
      );
      const network = context.insert(
        'networks',
        aNetwork(
          {
            name: NETWORK_NAME,
            reachTier: 2,
            coverage: { continentIds: [], countryIds: [SOUTH], regionIds: [] },
          },
          context.sequence,
        ),
      );
      const deal = options.deal === undefined ? { eventDefinitionId: definition.id } : options.deal;
      if (deal !== null) {
        context.insert(
          'deals',
          aDeal({ networkId: network.id, promotionId, ...deal }, context.sequence),
        );
      }
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId,
            eventDefinitionId: definition.id,
            regionId: NORTH_1,
            date: SHOW_DATE,
            airDate: SHOW_DATE,
            status: 'completed',
            format: { slots: 4, preShowSlots: 0 },
          },
          context.sequence,
        ),
      );
    })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 })
    .build();
  const at = <T>(list: readonly T[], index: number): T =>
    list[index] ?? expect.fail(`no ${String(index)}`);
  return {
    world,
    promotionId: ids.promotions.A ?? expect.fail('no promotion'),
    show: at(ids.eventInstances, 0),
    segment: at(ids.segments, 0),
    person: (index: number) => at(ids.people, index),
  };
}

function popularityIn(world: GameWorld, personId: PersonId, regionId: RegionId): number {
  return world.tables.people.require(personId).regionalPop[regionId] ?? 0;
}

describe('TV reach for worker popularity', () => {
  it('is registered once, at order 10, and a second provider with its id is refused', () => {
    expect(
      listPopularityReach().filter((provider) => provider.id === TV_REACH_PROVIDER_ID),
    ).toMatchObject([{ order: 10 }]);
    expect(() =>
      registerPopularityReach({ id: TV_REACH_PROVIDER_ID, order: 10, regionsFor: () => [] }),
    ).toThrow(RegistryError);
  });

  it('moves a televised match into a far TV country with the TV line', () => {
    const built = tvWorld();
    const tunables = createEngineTunables();
    const aftermath = computeSegmentAftermath(
      built.world,
      { segmentId: built.segment },
      tunables,
      geographyOf(built.world),
    );
    const tvLines = aftermath.weights.filter((line) => line.source === TV_REACH_PROVIDER_ID);
    expect(tvLines.map((line) => [line.regionId, line.reason])).toEqual([
      [SOUTH_1, `TV reach: ${NETWORK_NAME}`],
      [SOUTH_2, `TV reach: ${NETWORK_NAME}`],
    ]);
    for (const line of tvLines) {
      expect(line.weight).toBeCloseTo(TIER_2_WEIGHT * TV_SPILL, 10);
    }

    applyInOrder(built.world, [built.segment], tunables);
    const winner =
      built.world.tables.aftermaths
        .lookup('bySegment', built.segment)
        .find((row) => row.personId === built.person(0)) ?? expect.fail('no winner row');
    const delta = winner.popularity.delta;
    expect(delta).toBeGreaterThan(0);
    for (const regionId of [SOUTH_1, SOUTH_2]) {
      const region = winner.popularity.byRegion[regionId] ?? expect.fail(`no ${regionId}`);
      expect(region.after - region.before).toBeCloseTo(delta * TIER_2_WEIGHT * TV_SPILL, 2);
      expect(popularityIn(built.world, built.person(0), regionId)).toBe(region.after);
    }
    // The neighbour keeps its own, larger share.
    const north = winner.popularity.byRegion[NORTH_2] ?? expect.fail('no neighbour');
    expect(north.after - north.before).toBeCloseTo(delta * 0.4, 2);
  });

  it('reaches no TV region for a show no deal carries', () => {
    const built = tvWorld({ televised: false, deal: { eventDefinitionId: null } });
    const ctx: ReachContext = {
      promotionId: built.promotionId,
      eventInstanceId: built.show,
      regionId: NORTH_1,
      televised: false,
      importance: 'regular',
      date: SHOW_DATE,
    };
    expect(tvReachRegions(built.world, ctx, createEngineTunables())).toEqual([]);
    const weights = segmentRegionWeights(built.world, ctx, createEngineTunables());
    expect(weights.lines.map((line) => line.source)).toEqual(['show', 'neighbour']);
    applyInOrder(built.world, [built.segment]);
    expect(popularityIn(built.world, built.person(0), SOUTH_1)).toBe(40);
  });

  it('turns off with a spill of 0', () => {
    const built = tvWorld();
    const ctx: ReachContext = {
      promotionId: built.promotionId,
      eventInstanceId: built.show,
      regionId: NORTH_1,
      televised: true,
      importance: 'regular',
      date: SHOW_DATE,
    };
    expect(
      tvReachRegions(built.world, ctx, createEngineTunables({ 'match.popularity.tvSpill': 0 })),
    ).toEqual([]);
  });

  describe('in the Match lab', () => {
    const labCtx = (
      promotionId: ReachContext['promotionId'],
      televised: boolean,
    ): ReachContext => ({
      promotionId,
      eventInstanceId: null,
      regionId: NORTH_1,
      televised,
      importance: 'regular',
      date: SHOW_DATE,
    });

    it("uses the promotion's deals in force when Televised is on", () => {
      const built = tvWorld();
      const regions = tvReachRegions(
        built.world,
        labCtx(built.promotionId, true),
        createEngineTunables(),
      );
      expect(regions.map((region) => region.regionId)).toEqual([SOUTH_1, SOUTH_2]);
      expect(regions[0]?.reason).toBe(`TV reach: ${NETWORK_NAME}`);
    });

    it('reaches nothing when Televised is off, or when no deal is in force', () => {
      expect(
        tvReachRegions(
          tvWorld().world,
          labCtx(tvWorld().promotionId, false),
          createEngineTunables(),
        ),
      ).toEqual([]);
      const ended = tvWorld({ deal: { status: 'expired' } });
      expect(
        tvReachRegions(ended.world, labCtx(ended.promotionId, true), createEngineTunables()),
      ).toEqual([]);
    });
  });
});
