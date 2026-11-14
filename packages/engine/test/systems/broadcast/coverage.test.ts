// Which deal airs which show (ECO8-01): deals in force, definition-bound and promotion-wide
// deals, the instance path and the definition fallback, and the small helpers.
// Design: docs/design/broadcast.md#which-deal-airs-which-show.
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../src/core/date';
import type { EventDefinitionId } from '../../../src/core/ids';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../src/model/tables';
import {
  airingsDueOn,
  dealInForce,
  dealsAiringShow,
  hasActiveBroadcastDeal,
  networksCovering,
  promotionMarketRegionIds,
  type DueAiring,
} from '../../../src/systems/broadcast';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_START_DATE, type DeepPartial } from '../../support/builders/build-row';
import { anEventInstance } from '../../support/builders/creative';
import { aDeal, aNetwork } from '../../support/builders/media';
import { testId } from '../../support/ids';
import { worldBuilder, type BuiltWorld, type PromotionBuilder } from '../../support/world-builder';

// TEST_START_DATE is a Monday.
const MONDAY = TEST_START_DATE;
const TUESDAY = addDays(MONDAY, 1);
const WEDNESDAY = addDays(MONDAY, 2);
const SUNDAY = addDays(MONDAY, 6);
const NEXT_MONDAY = addDays(MONDAY, 7);

/**
 * Promotion A with a weekly Monday show, a major Sunday show and a Tuesday house show; three
 * networks (two TV channels and a pay-per-view provider) covering the whole map. `deals` adds A's
 * deals.
 */
function showWorld(deals: (promotion: PromotionBuilder) => unknown = () => undefined): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withNetwork({ name: 'Test TV One', kind: 'tv' })
    .withNetwork({ name: 'Test TV Two', kind: 'tv' })
    .withNetwork({ name: 'Test PPV', kind: 'ppv', reachTier: 3 })
    .withPromotion({}, (promotion) => {
      promotion
        .withWeeklyShow({ name: 'Test Weekly', weekdays: [0] })
        .withWeeklyShow({ name: 'Test Big Show', weekdays: [6] }, { importance: 'major' })
        .withWeeklyShow(
          { name: 'Test House Show', weekdays: [1] },
          { importance: 'house', televised: false },
        );
      deals(promotion);
    })
    .build();
}

/** `<deal index>:<show name>:<source>` for each due airing, in order. */
function dueOn(built: BuiltWorld, date: GameDate): string[] {
  const { world, ids } = built;
  return airingsDueOn(world, date).map((due: DueAiring) => {
    const show = due.source === 'instance' ? due.instance.name : due.definition.name;
    return `${String(ids.deals.indexOf(due.deal.id))}:${show}:${due.source}`;
  });
}

function definitionId(built: BuiltWorld, index: number): EventDefinitionId {
  const id = built.ids.eventDefinitions[index];
  if (id === undefined) {
    throw new Error(`no definition ${String(index)}`);
  }
  return id;
}

/** Adds a dated show of definition `index` (default: the weekly show). */
function addShow(
  built: BuiltWorld,
  overrides: DeepPartial<EventInstance>,
  index = 0,
): EventInstance {
  const world: GameWorld = built.world;
  const definition = world.tables.eventDefinitions.require(definitionId(built, index));
  const result = world.transact('add a show', (tx) =>
    tx.insert(
      'eventInstances',
      anEventInstance({
        promotionId: definition.promotionId,
        eventDefinitionId: definition.id,
        name: definition.name,
        importance: definition.importance,
        regionId: testId('region', 1),
        ...overrides,
      }),
    ),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

describe('dealInForce', () => {
  const network = aNetwork();
  const deal = aDeal({ startsOn: MONDAY, endsOn: NEXT_MONDAY });

  it('runs from startsOn up to the day before endsOn', () => {
    expect(dealInForce(deal, network, addDays(MONDAY, -1))).toBe(false);
    expect(dealInForce(deal, network, MONDAY)).toBe(true);
    expect(dealInForce(deal, network, SUNDAY)).toBe(true);
    expect(dealInForce(deal, network, NEXT_MONDAY)).toBe(false);
  });

  it('needs an active deal on an active network not yet closed', () => {
    expect(dealInForce({ ...deal, status: 'offered' }, network, MONDAY)).toBe(false);
    const closed = aNetwork({ status: 'closed', closedOn: TUESDAY });
    expect(dealInForce(deal, closed, MONDAY)).toBe(false);
    const closing = aNetwork({ closedOn: TUESDAY });
    expect(dealInForce(deal, closing, MONDAY)).toBe(true);
    expect(dealInForce(deal, closing, TUESDAY)).toBe(false);
  });
});

describe('airingsDueOn: which deal airs which show', () => {
  it('airs a definition-bound deal on its own show only', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', show: 'Test Weekly' }),
    );
    expect(dueOn(built, MONDAY)).toEqual(['0:Test Weekly:definition']);
    expect(dueOn(built, SUNDAY)).toEqual([]);
    expect(dueOn(built, NEXT_MONDAY)).toEqual(['0:Test Weekly:definition']);
  });

  it('airs the promotion-wide pay-per-view deal on the major show, not the weekly', () => {
    const built = showWorld((promotion) => promotion.withDeal({ network: 'Test PPV' }));
    expect(dueOn(built, MONDAY)).toEqual([]);
    expect(dueOn(built, SUNDAY)).toEqual(['0:Test Big Show:definition']);
  });

  it('airs a promotion-wide TV deal on every televised show except the house show', () => {
    const built = showWorld((promotion) => promotion.withDeal({ network: 'Test TV One' }));
    expect(dueOn(built, MONDAY)).toEqual(['0:Test Weekly:definition']);
    expect(dueOn(built, TUESDAY)).toEqual([]);
    expect(dueOn(built, SUNDAY)).toEqual(['0:Test Big Show:definition']);
  });

  it('lets a definition-bound TV deal win over a promotion-wide TV deal', () => {
    const built = showWorld((promotion) =>
      promotion
        .withDeal({ network: 'Test TV One' })
        .withDeal({ network: 'Test TV Two', show: 'Test Weekly' })
        .withDeal({ network: 'Test PPV' }),
    );
    expect(dueOn(built, MONDAY)).toEqual(['1:Test Weekly:definition']);
    // The pay-per-view deal is another kind of network: it still airs the major show.
    expect(dueOn(built, SUNDAY)).toEqual([
      '0:Test Big Show:definition',
      '2:Test Big Show:definition',
    ]);
  });

  it('lets the promotion-wide deal back in once the specific deal has ended', () => {
    const built = showWorld((promotion) =>
      promotion
        .withDeal({ network: 'Test TV One' })
        .withDeal({ network: 'Test TV Two', show: 'Test Weekly', endsOn: NEXT_MONDAY }),
    );
    expect(dueOn(built, MONDAY)).toEqual(['1:Test Weekly:definition']);
    expect(dueOn(built, NEXT_MONDAY)).toEqual(['0:Test Weekly:definition']);
  });

  it('does not air a deal before startsOn or on endsOn', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({
        network: 'Test TV One',
        show: 'Test Weekly',
        startsOn: NEXT_MONDAY,
        endsOn: addDays(NEXT_MONDAY, 7),
      }),
    );
    expect(dueOn(built, MONDAY)).toEqual([]);
    expect(dueOn(built, NEXT_MONDAY)).toEqual(['0:Test Weekly:definition']);
    expect(dueOn(built, addDays(NEXT_MONDAY, 7))).toEqual([]);
  });

  it('airs nothing on a network once it has closed', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withNetwork({ name: 'Test Closing TV', overrides: { closedOn: NEXT_MONDAY } })
      .withPromotion({}, (promotion) =>
        promotion.withWeeklyShow({ name: 'Test Weekly' }).withDeal({ network: 0 }),
      )
      .build();
    expect(dueOn(built, MONDAY)).toEqual(['0:Test Weekly:definition']);
    expect(dueOn(built, NEXT_MONDAY)).toEqual([]);
  });

  it('never airs a house show, even on a deal made for it', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', show: 'Test House Show' }),
    );
    expect(dueOn(built, TUESDAY)).toEqual([]);
  });

  it('still lists a cancelled show as due, for settlement to record as missed', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', show: 'Test Weekly' }),
    );
    addShow(built, { date: MONDAY, status: 'cancelled' });
    expect(dueOn(built, MONDAY)).toEqual(['0:Test Weekly:instance']);
  });

  it('airs a taped show on its air date, not its taping day', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', show: 'Test Weekly' }),
    );
    addShow(built, { date: MONDAY, airDate: WEDNESDAY });
    expect(dueOn(built, MONDAY)).toEqual([]);
    expect(dueOn(built, WEDNESDAY)).toEqual(['0:Test Weekly:instance']);
  });

  it('airs a definition from its recurrence only while it has no dated shows', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', show: 'Test Weekly' }),
    );
    expect(dueOn(built, MONDAY)).toEqual(['0:Test Weekly:definition']);
    expect(dueOn(built, TUESDAY)).toEqual([]);
    // Once the calendar has a show for it, a day without one means no show that day.
    addShow(built, { date: NEXT_MONDAY });
    expect(dueOn(built, MONDAY)).toEqual([]);
    expect(dueOn(built, NEXT_MONDAY)).toEqual(['0:Test Weekly:instance']);
  });

  it('does not air a definition outside its active dates', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withNetwork()
      .withPromotion({}, (promotion) =>
        promotion
          .withWeeklyShow({ name: 'Test Weekly' }, { activeFrom: NEXT_MONDAY })
          .withDeal({ network: 0 }),
      )
      .build();
    expect(dueOn(built, MONDAY)).toEqual([]);
    expect(dueOn(built, NEXT_MONDAY)).toEqual(['0:Test Weekly:definition']);
  });

  it('airs a one-off show on a promotion-wide deal by its importance', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One' }).withDeal({ network: 'Test PPV' }),
    );
    addShow(built, {
      eventDefinitionId: null,
      name: 'Test Special',
      importance: 'flagship',
      date: WEDNESDAY,
    });
    expect(dueOn(built, WEDNESDAY)).toEqual(['0:Test Special:instance', '1:Test Special:instance']);
  });

  it("never airs another promotion's show", () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withNetwork()
      .withPromotion({}, (promotion) => promotion.withDeal({ network: 0 }))
      .withPromotion({}, (promotion) => promotion.withWeeklyShow({ name: 'Test Rival Weekly' }))
      .build();
    expect(dueOn(built, MONDAY)).toEqual([]);
  });
});

describe('dealsAiringShow', () => {
  it('lists every deal airing a dated show, in id order', () => {
    const built = showWorld((promotion) =>
      promotion
        .withDeal({ network: 'Test TV One' })
        .withDeal({ network: 'Test PPV' })
        .withDeal({ network: 'Test TV Two', show: 'Test Big Show' }),
    );
    const bigShow = addShow(built, { date: SUNDAY }, 1);
    const weekly = addShow(built, { date: MONDAY });
    expect(dealsAiringShow(built.world, bigShow).map((deal) => deal.id)).toEqual([
      built.ids.deals[1],
      built.ids.deals[2],
    ]);
    expect(dealsAiringShow(built.world, weekly).map((deal) => deal.id)).toEqual([
      built.ids.deals[0],
    ]);
  });
});

describe('networks a promotion can deal with', () => {
  // The mini geography's regions, in the order it adds them.
  const HOME = testId('region', 1);
  const SECOND = testId('region', 2);
  const THIRD = testId('region', 3);
  const FAR = testId('region', 4);

  it('lists the home region and every region at or above the popularity floor', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ homeRegionId: HOME, regionalPop: { [THIRD]: 5, [FAR]: 0.5 } })
      .build();
    expect(built.ids.regions).toEqual([HOME, SECOND, THIRD, FAR]);
    const promotionId = built.ids.promotions.A!;
    expect(promotionMarketRegionIds(built.world, promotionId, createEngineTunables())).toEqual([
      HOME,
      THIRD,
    ]);
    const everywhere = createEngineTunables({ 'broadcast.networks.minPopularityToList': 0 });
    expect(promotionMarketRegionIds(built.world, promotionId, everywhere)).toEqual([
      HOME,
      SECOND,
      THIRD,
      FAR,
    ]);
  });

  it("lists active networks covering the market, without other promotions' own services", () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ homeRegionId: HOME })
      .withPromotion({ homeRegionId: FAR })
      .withNetwork({ name: 'Test Home Local', coverage: { regionIds: [HOME] } })
      .withNetwork({ name: 'Test Far Local', coverage: { regionIds: [FAR] } })
      .withNetwork({ name: 'Test Closed', overrides: { status: 'closed', closedOn: TUESDAY } })
      .with('own services', (context) => {
        const owners = [
          ['Test Our Stream', context.ids.promotions.A!],
          ['Test Their Stream', context.ids.promotions.B!],
        ] as const;
        for (const [name, owner] of owners) {
          context.insert(
            'networks',
            aNetwork(
              {
                name,
                kind: 'streaming',
                ownerPromotionId: owner,
                launchedOn: addDays(MONDAY, -400),
                coverage: { regionIds: [HOME] },
              },
              context.sequence,
            ),
          );
        }
      })
      .build();
    const names = networksCovering(
      built.world,
      built.ids.promotions.A!,
      createEngineTunables(),
    ).map((network) => network.name);
    expect(names).toEqual(['Test Home Local', 'Test Our Stream']);
  });

  it('knows whether a promotion has a deal in force on a day', () => {
    const built = showWorld((promotion) =>
      promotion.withDeal({ network: 'Test TV One', startsOn: TUESDAY, endsOn: SUNDAY }),
    );
    const promotionId = built.ids.promotions.A!;
    expect(hasActiveBroadcastDeal(built.world, promotionId, MONDAY)).toBe(false);
    expect(hasActiveBroadcastDeal(built.world, promotionId, TUESDAY)).toBe(true);
    expect(hasActiveBroadcastDeal(built.world, promotionId, SUNDAY)).toBe(false);
  });
});
