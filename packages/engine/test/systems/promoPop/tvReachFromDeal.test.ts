// EVT5 and ECO8 together (ECO8-07): a TV deal signed with `broadcast.proposeDeal` carries the
// promotion's next show into the network's regions, and once the deal is cancelled the next show
// no longer reaches them. The shipped default world can't show this (Hardpan's only willing
// network, Bluebonnet Cable 7, covers just Texas, Hardpan's own show region), so a small world
// does: the show is in North 1 and the regional network covers the South.
// Design: docs/design/promotion-popularity.md#show-reach, docs/design/broadcast.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { compareDates, parseGameDate } from '../../../src/core/date';
import type { DealId, EventInstanceId, PromotionId } from '../../../src/core/ids';
import type { PopularityShowChange } from '../../../src/model/entities/popularity-show-change';
import { defaultSystems } from '../../../src/systems';
import { withMyShowsRun } from '../../support';
import { worldBuilder } from '../../support/world-builder';
import { NORTH_1, OMNISCIENT, SOUTH, SOUTH_1, SOUTH_2 } from './show-world';

const PLAYER = { kind: 'human', playerId: 'player-1' } as const;
const TODAY = parseGameDate('2026-06-06');

function regionalWorld() {
  const built = worldBuilder({
    startDate: '2025-01-01',
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withGeography('mini')
    .withNetwork({
      name: 'Test Southern Sports',
      kind: 'tv',
      reachTier: 1,
      coverage: { continentIds: [], countryIds: [SOUTH], regionIds: [] },
    })
    .withPromotion(
      {
        name: 'Test Promotion A',
        controller: PLAYER,
        homeRegionId: NORTH_1,
        regionalPop: Object.fromEntries(
          [NORTH_1, SOUTH_1, SOUTH_2].map((regionId) => [regionId, 60]),
        ),
      },
      (promotion) =>
        promotion.withRoster(12).withWeeklyShow({ name: 'Test Weekly', weekdays: [0] }),
    )
    .build();
  const promotionId = built.ids.promotions.A;
  const [networkId] = built.ids.networks;
  const [showId] = built.ids.eventDefinitions;
  if (promotionId === undefined || networkId === undefined || showId === undefined) {
    throw new Error('The regional world is missing a row');
  }
  return { ...built, promotionId, networkId, showId };
}

function completedShows(engine: Engine, promotionId: PromotionId): EventInstanceId[] {
  return engine
    .exportState()
    .world.tables.eventInstances.filter(
      (show) => show.promotionId === promotionId && show.status === 'completed',
    )
    .sort((left, right) => compareDates(left.date, right.date))
    .map((show) => show.id);
}

function changeOf(engine: Engine, eventInstanceId: EventInstanceId): PopularityShowChange {
  const change = engine
    .exportState()
    .world.tables.popularityShowChanges.find((row) => row.eventInstanceId === eventInstanceId);
  if (change === undefined) throw new Error(`No popularity change for ${eventInstanceId}`);
  return change;
}

function tvRegions(change: PopularityShowChange): string[] {
  return Object.entries(change.regions)
    .filter(([, region]) => region.source === 'tv')
    .map(([regionId]) => regionId)
    .sort();
}

async function advance(engine: Engine, days: number): Promise<void> {
  const advanced = await engine.advanceDays({ maxDays: days });
  expect(advanced.failures).toEqual([]);
  expect(advanced.daysAdvanced).toBe(days);
}

describe('TV reach from a signed deal (EVT5 with ECO8)', () => {
  it('reaches the network regions while the deal runs, and not after it is cancelled', async () => {
    const built = regionalWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      // The player presses Run the show on each show day.
      systems: withMyShowsRun(defaultSystems),
    });

    const signed = engine.command(
      'broadcast.proposeDeal',
      {
        promotionId: built.promotionId,
        networkId: built.networkId,
        eventDefinitionId: built.showId,
        timeslot: 'evening',
        live: false,
        months: 12,
      },
      PLAYER,
    );
    if (!signed.ok) throw new Error(JSON.stringify(signed.reasons));
    const dealId: DealId = signed.data.dealId;

    // Monday's show (8 Jun) runs and airs on the deal.
    await advance(engine, 3);
    const [first] = completedShows(engine, built.promotionId);
    if (first === undefined) throw new Error('The first show did not run');
    expect(tvRegions(changeOf(engine, first))).toEqual([SOUTH_1, SOUTH_2].sort());
    const airing = engine
      .exportState()
      .world.tables.airings.find((row) => row.eventInstanceId === first);
    expect(airing).toMatchObject({ dealId, status: 'aired' });
    // The results page's "Seen here as" line names what the airing drew.
    const view = engine.query('popularity.showChange', { eventInstanceId: first }, OMNISCIENT);
    if (!view.ok) throw new Error(JSON.stringify(view.reasons));
    const south = view.data.countries
      .flatMap((country) => country.regions)
      .find((region) => region.regionId === SOUTH_1);
    expect(south?.sourceLabel).toMatch(/^TV: Test Southern Sports, [\d.]+[KM]? viewers$/);

    const cancelled = engine.command('broadcast.cancelDeal', { dealId }, PLAYER);
    if (!cancelled.ok) throw new Error(JSON.stringify(cancelled.reasons));
    await advance(engine, 7);
    const shows = completedShows(engine, built.promotionId);
    const second = shows[1];
    if (second === undefined) throw new Error('The second show did not run');
    expect(tvRegions(changeOf(engine, second))).toEqual([]);
    expect(
      engine.exportState().world.tables.airings.filter((row) => row.eventInstanceId === second),
    ).toEqual([]);
  });
});
