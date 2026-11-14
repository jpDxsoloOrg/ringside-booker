// EVT1 and ECO8 together (ECO8-07): cancelling a televised show ahead of time with
// `calendar.cancelShow` shows up on the deal at once and costs the deal an airing on the show's air
// date, with no money. Design: docs/design/broadcast.md#settlement
import { describe, expect, it } from 'vitest';
import type { Viewer } from '../../../../src/core/api';
import { cents } from '../../../../src/core/money';
import type { DealId, EventInstanceId } from '../../../../src/core/ids';
import { aDeal, aNetwork } from '../../../support/builders/media';
import {
  advance,
  engineOver,
  gameDate,
  lifecycleWorldWith,
  LIFECYCLE_START,
  OMNISCIENT,
  PLAYER_ONE,
} from '../../calendar/lifecycle-world';

const NEXT_WEEK = gameDate('2026-01-12');
const START = gameDate(LIFECYCLE_START);
const AS_PLAYER: Viewer = { kind: 'controller', controller: PLAYER_ONE };

interface Kept {
  readonly show: EventInstanceId;
  readonly deal: DealId;
}

function televisedShowWorld() {
  return lifecycleWorldWith<Kept>((addShow, { promotionA }, context) => {
    const regionIds = [...context.ids.regions];
    const network = context.insert(
      'networks',
      aNetwork(
        { name: 'Test Channel', coverage: { continentIds: [], countryIds: [], regionIds } },
        context.sequence,
      ),
    );
    const deal = context.insert(
      'deals',
      aDeal(
        {
          networkId: network.id,
          promotionId: promotionA,
          startsOn: START,
          offeredOn: START,
          terms: {
            feePerShow: cents(100_000),
            perThousandViewers: cents(500),
            costPerShow: cents(20_000),
          },
        },
        context.sequence,
      ),
    );
    const show = addShow({
      date: NEXT_WEEK,
      airDate: NEXT_WEEK,
      promotionId: promotionA,
      importance: 'regular',
      eventDefinitionId: null,
    });
    return { show, deal: deal.id };
  });
}

describe('cancelling a televised show (EVT1)', () => {
  it('lists it as a missed airing to come at once, then misses the airing with no money', async () => {
    const built = televisedShowWorld();
    const engine = engineOver(built);
    const cancelled = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: built.shows.show },
      PLAYER_ONE,
    );
    expect(cancelled.ok).toBe(true);

    const deals = engine.query(
      'broadcast.deals',
      { promotionId: built.promotionA, include: 'active' },
      AS_PLAYER,
    );
    if (!deals.ok) throw new Error(JSON.stringify(deals.reasons));
    const row = deals.data.find((deal) => deal.dealId === built.shows.deal);
    expect(row?.upcomingMissed).toEqual([NEXT_WEEK]);
    const sheet = engine.query(
      'broadcast.showAiring',
      { eventInstanceId: built.shows.show },
      AS_PLAYER,
    );
    if (!sheet.ok) throw new Error(JSON.stringify(sheet.reasons));
    // Cancelled: nothing is still to air it, and nothing has aired yet.
    expect(sheet.data).toMatchObject({ upcoming: false, airing: null });

    const state = await advance(engine, 8);
    const airings = state.world.tables.airings.filter(
      (airing) => airing.eventInstanceId === built.shows.show,
    );
    expect(airings).toHaveLength(1);
    expect(airings[0]).toMatchObject({
      dealId: built.shows.deal,
      airDate: NEXT_WEEK,
      status: 'missed',
      missReason: 'showCancelled',
      viewers: 0,
      income: 0,
      cost: 0,
    });
    expect(
      state.world.tables.ledgerEntries.filter((entry) => entry.refs.dealId === built.shows.deal),
    ).toEqual([]);
    const after = engine.query(
      'broadcast.showAiring',
      { eventInstanceId: built.shows.show },
      OMNISCIENT,
    );
    if (!after.ok) throw new Error(JSON.stringify(after.reasons));
    expect(after.data.airing).toMatchObject({
      status: 'missed',
      missReason: 'showCancelled',
      note: 'Show cancelled: nothing aired',
    });
    expect(after.data.airings.map((row) => row.status)).toEqual(['missed']);
  });
});
