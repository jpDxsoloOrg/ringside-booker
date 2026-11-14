// What a player may see of TV deals (ECO8-03): that a deal exists is public, its money is not.
// Design: docs/design/broadcast.md#queries-and-visibility
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import type {
  DealId,
  EventDefinitionId,
  NetworkId,
  PromotionId,
  RegionId,
} from '../../../../src/core/ids';
import {
  NOT_YOUR_PROMOTION,
  NOT_YOUR_SHOW,
  UNKNOWN_DEAL,
  UNKNOWN_NETWORK,
  UNKNOWN_SHOW,
  type BroadcastValuationArgs,
} from '../../../../src/systems/broadcast';
import { cents } from '../../../../src/core/money';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { testId } from '../../../support/ids';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support/systems';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

const RIVAL_PLAYER_ID = 'player-2';
const YOU: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: TEST_PLAYER_ID } };
const RIVAL_HUMAN: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: RIVAL_PLAYER_ID },
};
const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };

/** Fees no query may show anyone but the deal's owner. */
const RIVAL_FEE = 987_654;
const RIVAL_PER_THOUSAND = 4_321;
const RIVAL_COST = 1_234;
const MONEY_KEYS = /fee|perThousand|cost|income|terms|viewers|benchmark|ratio/i;

interface VisibilityWorld {
  readonly engine: Engine;
  readonly you: PromotionId;
  readonly rival: PromotionId;
  readonly yourName: string;
  readonly rivalName: string;
  readonly network: NetworkId;
  readonly yourShow: EventDefinitionId;
  readonly rivalShow: EventDefinitionId;
  readonly yourDeal: DealId;
  readonly rivalDeal: DealId;
}

const REGION_IDS: readonly RegionId[] = worldBuilder()
  .withGeography('mini')
  .build()
  .world.tables.regions.ids();
const POPULAR: Record<string, number> = Object.fromEntries(REGION_IDS.map((id) => [id, 60]));

/**
 * Your promotion (A) and a rival run by another human (B), both popular on the whole mini map,
 * each with a Monday show; one local TV channel airs B's show on Monday evenings and your show
 * on Tuesday evenings, and a pay-per-view provider airs B's major shows.
 */
function visibilityWorld(): VisibilityWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withNetwork({ name: 'Local TV', kind: 'tv', reachTier: 0 })
    .withNetwork({ name: 'Test PPV', kind: 'ppv', reachTier: 0 })
    .withPromotion(
      { controller: { kind: 'human', playerId: TEST_PLAYER_ID }, regionalPop: POPULAR },
      (promotion) =>
        promotion
          .withWeeklyShow({ name: 'Your Tuesday', weekdays: [1] })
          .withDeal({ network: 0, show: 'Your Tuesday', timeslot: 'evening', weekday: 1 }),
    )
    .withPromotion(
      { controller: { kind: 'human', playerId: RIVAL_PLAYER_ID }, regionalPop: POPULAR },
      (promotion) =>
        promotion
          .withWeeklyShow({ name: 'Rival Monday', weekdays: [0] })
          .withDeal({
            network: 0,
            show: 'Rival Monday',
            timeslot: 'evening',
            weekday: 0,
            terms: {
              feePerShow: cents(RIVAL_FEE),
              perThousandViewers: cents(RIVAL_PER_THOUSAND),
              costPerShow: cents(RIVAL_COST),
            },
          })
          .withDeal({ network: 1 }),
    )
    .build();
  const you = ids.promotions.A;
  const rival = ids.promotions.B;
  const network = ids.networks[0];
  const [yourShow, rivalShow] = ids.eventDefinitions;
  const [yourDeal, rivalDeal] = ids.deals;
  if (
    you === undefined ||
    rival === undefined ||
    network === undefined ||
    yourShow === undefined ||
    rivalShow === undefined ||
    yourDeal === undefined ||
    rivalDeal === undefined
  ) {
    throw new Error('setup');
  }
  const engine = createEngine({
    state: initialEngineState(world),
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
  const { promotions } = world.tables;
  const yourName = promotions.require(you).name;
  const rivalName = promotions.require(rival).name;
  return {
    engine,
    you,
    rival,
    yourName,
    rivalName,
    network,
    yourShow,
    rivalShow,
    yourDeal,
    rivalDeal,
  };
}

function args(
  world: VisibilityWorld,
  overrides: Partial<BroadcastValuationArgs> = {},
): BroadcastValuationArgs {
  return {
    promotionId: world.you,
    networkId: world.network,
    eventDefinitionId: world.yourShow,
    timeslot: 'evening',
    live: false,
    months: 24,
    ...overrides,
  };
}

function refusalCodes(result: { ok: boolean; reasons?: readonly { code: string }[] }): string[] {
  return result.ok ? [] : (result.reasons ?? []).map((reason) => reason.code);
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

describe("a rival's deal screens", () => {
  it("refuses another human the rival's networks and valuation", () => {
    const world = visibilityWorld();
    const { engine, rival, rivalShow } = world;
    for (const viewer of [YOU, COMPUTER]) {
      expect(
        refusalCodes(engine.query('broadcast.networks', { promotionId: rival }, viewer)),
      ).toEqual([NOT_YOUR_PROMOTION]);
      expect(
        refusalCodes(
          engine.query(
            'broadcast.valuation',
            args(world, { promotionId: rival, eventDefinitionId: rivalShow }),
            viewer,
          ),
        ),
      ).toEqual([NOT_YOUR_PROMOTION]);
    }
    expect(engine.query('broadcast.networks', { promotionId: rival }, RIVAL_HUMAN).ok).toBe(true);
    expect(engine.query('broadcast.networks', { promotionId: rival }, OMNISCIENT_VIEWER).ok).toBe(
      true,
    );
  });

  it('lists rival shows a network carries by name, without their money', () => {
    const world = visibilityWorld();
    const result = world.engine.query('broadcast.networks', { promotionId: world.you }, YOU);
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const local = result.data.find((row) => row.networkId === world.network);
    expect(local?.carries).toEqual([
      {
        dealId: world.yourDeal,
        promotionName: world.yourName,
        showName: 'Your Tuesday',
        weekday: 1,
        timeslot: 'evening',
      },
      {
        dealId: world.rivalDeal,
        promotionName: world.rivalName,
        showName: 'Rival Monday',
        weekday: 0,
        timeslot: 'evening',
      },
    ]);
    expect(local?.yourDeals).toEqual([world.yourDeal]);
    const carriedKeys = keysOf(result.data.map((row) => row.carries));
    expect(carriedKeys.filter((key) => MONEY_KEYS.test(key))).toEqual([]);
    const text = JSON.stringify(result.data);
    for (const amount of [RIVAL_FEE, RIVAL_PER_THOUSAND, RIVAL_COST]) {
      expect(text).not.toContain(String(amount));
    }
    expectSerialisable(result.data);
  });
});

describe('broadcast.publicDeals', () => {
  it("shows any promotion's live deals to every viewer, and no money", () => {
    const world = visibilityWorld();
    for (const viewer of [YOU, RIVAL_HUMAN, COMPUTER, OMNISCIENT_VIEWER]) {
      const result = world.engine.query(
        'broadcast.publicDeals',
        { promotionId: world.rival },
        viewer,
      );
      if (!result.ok) throw new Error(JSON.stringify(result.reasons));
      expect(result.data.map((row) => [row.networkName, row.showName, row.kind])).toEqual([
        ['Local TV', 'Rival Monday', 'tv'],
        ['Test PPV', 'All major shows', 'ppv'],
      ]);
      expect(keysOf(result.data).filter((key) => MONEY_KEYS.test(key))).toEqual([]);
      const text = JSON.stringify(result.data);
      for (const amount of [RIVAL_FEE, RIVAL_PER_THOUSAND, RIVAL_COST]) {
        expect(text).not.toContain(String(amount));
      }
    }
  });
});

describe('broadcast.valuation', () => {
  it('previews your own deal with every number and its Why? inline', () => {
    const world = visibilityWorld();
    const result = world.engine.query(
      'broadcast.valuation',
      args(world, { timeslot: 'daytime', months: 12 }),
      YOU,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.verdict).toBe('refuse');
    // Your show is on Local TV already: a new deal for it collides with the one you have.
    expect(result.data.refusals.map((refusal) => refusal.code)).toEqual(['alreadyOnNetwork']);
    expect(result.data.projectedViewers.trace.kind).toBe('formula');
    expect(result.data.verdictTrace.kind).toBe('decision');
    expectSerialisable(result.data);
  });

  it('leaves the deal being renegotiated out of its own checks', () => {
    const world = visibilityWorld();
    const result = world.engine.query(
      'broadcast.valuation',
      args(world, { dealId: world.yourDeal }),
      YOU,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expect(result.data.refusals).toEqual([]);
  });

  it('refuses unknown networks, shows and deals, and rival shows', () => {
    const world = visibilityWorld();
    const { engine } = world;
    const cases: readonly (readonly [Partial<BroadcastValuationArgs>, string])[] = [
      [{ networkId: testId('network', 999) }, UNKNOWN_NETWORK],
      [{ eventDefinitionId: testId('eventDefinition', 999) }, UNKNOWN_SHOW],
      [{ eventDefinitionId: world.rivalShow }, NOT_YOUR_SHOW],
      [{ dealId: world.rivalDeal }, UNKNOWN_DEAL],
    ];
    for (const [overrides, code] of cases) {
      expect(
        refusalCodes(engine.query('broadcast.valuation', args(world, overrides), YOU)),
      ).toEqual([code]);
    }
  });
});
