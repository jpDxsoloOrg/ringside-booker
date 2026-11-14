// How long airings are kept (ECO8-04): the player's for `broadcast.airing.historyDays`, each deal's
// newest whatever their age; the queries over them. Design: docs/design/broadcast.md#retention
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { addDays, parseGameDate } from '../../../../src/core/date';
import type { AiringId, DealId, PromotionId } from '../../../../src/core/ids';
import { cents } from '../../../../src/core/money';
import type { GameWorld } from '../../../../src/model/tables';
import {
  AIRING_LOSS_NOTE,
  broadcastSystem,
  newestAiringsPerDeal,
} from '../../../../src/systems/broadcast';
import { anAiring } from '../../../support/builders/media';
import { worldBuilder } from '../../../support/world-builder';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-1' },
};
/** A Thursday 1 October: the monthly prune runs on the day the engine advances over. */
const FIRST_OF_MONTH = '2026-10-01';

interface RetentionWorld {
  readonly world: GameWorld;
  readonly promotionId: PromotionId;
  readonly deals: readonly DealId[];
  /** Airing ids by label. */
  readonly rows: Readonly<Record<string, AiringId>>;
}

function retentionWorld(): RetentionWorld {
  const { world, ids } = worldBuilder({
    startDate: '2025-01-01',
    currentDate: FIRST_OF_MONTH,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withGeography('mini')
    .withNetwork({ name: 'Test TV', kind: 'tv' })
    .withNetwork({ name: 'Test Stream', kind: 'streaming' })
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: 'player-1' } },
      (promotion) => {
        promotion.withDeal({ network: 0, startsOn: parseGameDate('2025-01-01') });
        promotion.withDeal({ network: 1, startsOn: parseGameDate('2025-01-01') });
      },
    )
    .build();
  const [tv, stream] = ids.deals;
  const [tvNetwork, streamNetwork] = ids.networks;
  const promotionId = ids.promotions.A;
  if (
    tv === undefined ||
    stream === undefined ||
    tvNetwork === undefined ||
    streamNetwork === undefined ||
    promotionId === undefined
  ) {
    throw new Error('The retention world is missing a deal');
  }
  const today = parseGameDate(FIRST_OF_MONTH);
  const rows: Record<string, AiringId> = {};
  const result = world.transact('airings', (tx) => {
    const add = (label: string, dealId: DealId, daysAgo: number, extra = {}) => {
      rows[label] = tx.insert(
        'airings',
        anAiring({
          id: tx.mintId('airings'),
          dealId,
          networkId: dealId === tv ? tvNetwork : streamNetwork,
          promotionId,
          showName: `Test ${label}`,
          airDate: addDays(today, -daysAgo),
          ...extra,
        }),
      ).id;
    };
    add('tv-oldest', tv, 450);
    add('tv-old', tv, 420);
    add('tv-year', tv, 300, { cost: cents(200_000), quality: { score: 60, source: 'show' } });
    add('tv-recent', tv, 10, {
      status: 'missed',
      missReason: 'showCancelled',
      quality: null,
      viewers: 0,
      income: cents(0),
    });
    add('stream-oldest', stream, 500);
    add('stream-old', stream, 480);
  });
  if (!result.ok) throw result.error;
  return { world, promotionId, deals: [tv, stream], rows };
}

function engineFor(world: GameWorld, keepPerDeal: number): Engine {
  return createEngine({
    state: {
      ...initialEngineState(world),
      tunableOverrides: { 'broadcast.airing.keepPerDeal': keepPerDeal },
    },
    systems: [simSystem, broadcastSystem],
  });
}

function airingIds(engine: Engine): string[] {
  return engine
    .exportState()
    .world.tables.airings.map((row) => row.showName)
    .sort();
}

describe('broadcast.pruneAirings', () => {
  it("deletes the player's airings past historyDays, keeping each deal's newest", async () => {
    const built = retentionWorld();
    const engine = engineFor(built.world, 2);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    // TV keeps its two newest (a year ago and last week) and drops the two older than 400 days;
    // the stream deal's only airings are both older, and both stay as its newest.
    expect(airingIds(engine)).toEqual([
      'Test stream-old',
      'Test stream-oldest',
      'Test tv-recent',
      'Test tv-year',
    ]);
  });

  it('picks the newest of each deal by air date', () => {
    const built = retentionWorld();
    const keep = newestAiringsPerDeal(built.world, 1);
    expect([...keep].sort()).toEqual([built.rows['tv-recent'], built.rows['stream-old']].sort());
  });
});

describe('the airing queries', () => {
  it('lists newest first, filters by deal and dates, and explains each row', () => {
    const built = retentionWorld();
    const engine = engineFor(built.world, 12);
    const [tv] = built.deals;
    const listed = engine.query(
      'broadcast.airings',
      {
        promotionId: built.promotionId,
        ...(tv === undefined ? {} : { dealId: tv }),
        from: addDays(parseGameDate(FIRST_OF_MONTH), -350),
      },
      PLAYER,
    );
    if (!listed.ok) throw new Error(JSON.stringify(listed.reasons));
    expect(listed.data.map((row) => [row.showName, row.note])).toEqual([
      ['Test tv-recent', 'Show cancelled: nothing aired'],
      ['Test tv-year', AIRING_LOSS_NOTE],
    ]);
    expect(listed.data[1]?.net).toBe(150_000 - 200_000);
  });
});
