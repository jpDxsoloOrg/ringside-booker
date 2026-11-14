// A small world for the deal commands and deal health (ECO8-05): your promotion and a computer
// rival, both popular on the whole mini map, each with a weekly show on one local TV channel.
// Design: docs/design/broadcast.md#deal-health and #commands
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { DomainEventMap } from '../../../src/core/events/types';
import type {
  DealId,
  EventDefinitionId,
  NetworkId,
  PromotionId,
  RegionId,
} from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { TunableRawValue } from '../../../src/core/tunables/define';
import type { Deal } from '../../../src/model/entities/deal';
import type { GameWorld } from '../../../src/model/tables';
import { broadcastSystem } from '../../../src/systems/broadcast';
import { financeSystem } from '../../../src/systems/finance';
import { anAiring } from '../../support/builders/media';
import { worldBuilder } from '../../support/world-builder';

export const PLAYER_ID = 'player-1';
export const YOU: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: PLAYER_ID },
};
export const YOU_ISSUING = { kind: 'human', playerId: PLAYER_ID } as const;
export const COMPUTER = { kind: 'computer' } as const;

/** A Saturday: neither weekly show (Monday, Tuesday) airs on the day the engine advances over. */
export const TODAY: GameDate = parseGameDate('2026-06-06');

const REGION_IDS: readonly RegionId[] = worldBuilder()
  .withGeography('mini')
  .build()
  .world.tables.regions.ids();
function popularity(points: number): Record<string, number> {
  return Object.fromEntries(REGION_IDS.map((id) => [id, points]));
}

export interface DealWorldOptions {
  /** The world seed (fixes the network's patience rolls). */
  readonly seed?: string;
  /** Your deal's first day; 200 days ago when left out. */
  readonly yourStartsOn?: GameDate;
  /** Your deal's end date; 300 days on when left out. */
  readonly yourEndsOn?: GameDate;
  /** The rival's deal's end date; 300 days on when left out. */
  readonly rivalEndsOn?: GameDate;
  /** The rival's popularity everywhere; 60 when left out. */
  readonly rivalPopularity?: number;
  /** Your Monday show's `televised`; true when left out. */
  readonly yourShowTelevised?: boolean;
}

export interface DealWorld {
  readonly world: GameWorld;
  readonly you: PromotionId;
  readonly rival: PromotionId;
  readonly network: NetworkId;
  readonly yourShow: EventDefinitionId;
  /** Your second weekly show (Thursday), with no deal. */
  readonly yourThursday: EventDefinitionId;
  readonly rivalShow: EventDefinitionId;
  readonly yourDeal: DealId;
  readonly rivalDeal: DealId;
}

export function dealWorld(options: DealWorldOptions = {}): DealWorld {
  const { world, ids } = worldBuilder({
    startDate: '2025-01-01',
    currentDate: TODAY,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    players: [{ playerId: PLAYER_ID, displayName: 'Test Player 1' }],
  })
    .withGeography('mini')
    .withNetwork({ name: 'Local TV', kind: 'tv', reachTier: 0 })
    .withPromotion(
      { controller: { kind: 'human', playerId: PLAYER_ID }, regionalPop: popularity(60) },
      (promotion) =>
        promotion
          .withWeeklyShow(
            { name: 'Your Monday', weekdays: [0] },
            { televised: options.yourShowTelevised ?? true },
          )
          .withWeeklyShow({ name: 'Your Thursday', weekdays: [3] })
          .withDeal({
            network: 0,
            show: 'Your Monday',
            timeslot: 'evening',
            weekday: 0,
            live: false,
            startsOn: options.yourStartsOn ?? addDays(TODAY, -200),
            endsOn: options.yourEndsOn ?? addDays(TODAY, 300),
            terms: {
              feePerShow: cents(100_000),
              perThousandViewers: cents(2_000),
              costPerShow: cents(10_000),
            },
          }),
    )
    .withPromotion(
      {
        controller: { kind: 'computer' },
        regionalPop: popularity(options.rivalPopularity ?? 60),
      },
      (promotion) =>
        promotion.withWeeklyShow({ name: 'Rival Tuesday', weekdays: [1] }).withDeal({
          network: 0,
          show: 'Rival Tuesday',
          timeslot: 'evening',
          weekday: 1,
          live: false,
          startsOn: addDays(TODAY, -200),
          endsOn: options.rivalEndsOn ?? addDays(TODAY, 300),
        }),
    )
    .build();
  const you = ids.promotions.A;
  const rival = ids.promotions.B;
  const [network] = ids.networks;
  const [yourShow, yourThursday, rivalShow] = ids.eventDefinitions;
  const [yourDeal, rivalDeal] = ids.deals;
  if (
    you === undefined ||
    rival === undefined ||
    network === undefined ||
    yourShow === undefined ||
    yourThursday === undefined ||
    rivalShow === undefined ||
    yourDeal === undefined ||
    rivalDeal === undefined
  ) {
    throw new Error('The deal world is missing a row');
  }
  return { world, you, rival, network, yourShow, yourThursday, rivalShow, yourDeal, rivalDeal };
}

/** One airing in a pattern: aired with these viewers against these expected, or missed. */
export type AiringPlan = { readonly viewers: number; readonly expected: number } | 'missed';

/**
 * Adds airings to a deal, newest first: the first is dated `TODAY`, each next one a week earlier.
 */
export function addAirings(
  built: DealWorld,
  dealId: DealId,
  plans: readonly AiringPlan[],
  newest: GameDate = TODAY,
): void {
  const deal = built.world.tables.deals.require(dealId);
  const result = built.world.transact('airings', (tx) => {
    plans.forEach((plan, index) => {
      const airDate = addDays(newest, -7 * index);
      tx.insert(
        'airings',
        anAiring({
          id: tx.mintId('airings'),
          dealId,
          networkId: deal.networkId,
          promotionId: deal.promotionId,
          eventDefinitionId: deal.eventDefinitionId,
          showName: 'Test show',
          airDate,
          ...(plan === 'missed'
            ? {
                status: 'missed',
                missReason: 'showCancelled',
                quality: null,
                viewers: 0,
                expectedViewers: 10_000,
                income: cents(0),
              }
            : { viewers: plan.viewers, expectedViewers: plan.expected }),
        }),
      );
    });
  });
  if (!result.ok) throw result.error;
}

/** `count` aired airings at `ratio` of what the network expected (10,000). */
export function airedAt(ratio: number, count: number): AiringPlan[] {
  return Array.from({ length: count }, () => ({
    viewers: Math.round(10_000 * ratio),
    expected: 10_000,
  }));
}

export function engineFor(
  world: GameWorld,
  overrides: Record<string, TunableRawValue> = {},
): Engine {
  return createEngine({
    state: { ...initialEngineState(world), tunableOverrides: overrides },
    systems: [simSystem, financeSystem, broadcastSystem],
  });
}

export async function advanceOneDay(engine: Engine): Promise<void> {
  const advanced = await engine.advanceDays({ maxDays: 1 });
  if (advanced.failures.length > 0) {
    throw new Error(JSON.stringify(advanced.failures));
  }
}

export function dealOf(engine: Engine, dealId: DealId): Deal {
  const deal = engine.exportState().world.tables.deals.find((row) => row.id === dealId);
  if (deal === undefined) throw new Error(`No deal ${dealId}`);
  return deal;
}

type BroadcastEventType =
  | 'broadcast.dealSigned'
  | 'broadcast.dealRenegotiated'
  | 'broadcast.dealEnded'
  | 'broadcast.dealWarned';

function recentEvents(engine: Engine, type: BroadcastEventType) {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: [type] },
    OMNISCIENT_VIEWER,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

export function signedEvents(engine: Engine): DomainEventMap['broadcast.dealSigned'][] {
  return recentEvents(engine, 'broadcast.dealSigned').flatMap((event) =>
    event.type === 'broadcast.dealSigned' ? [event.payload] : [],
  );
}

export function renegotiatedEvents(engine: Engine): DomainEventMap['broadcast.dealRenegotiated'][] {
  return recentEvents(engine, 'broadcast.dealRenegotiated').flatMap((event) =>
    event.type === 'broadcast.dealRenegotiated' ? [event.payload] : [],
  );
}

export function endedEvents(engine: Engine): DomainEventMap['broadcast.dealEnded'][] {
  return recentEvents(engine, 'broadcast.dealEnded').flatMap((event) =>
    event.type === 'broadcast.dealEnded' ? [event.payload] : [],
  );
}

export function warnedEvents(engine: Engine): DomainEventMap['broadcast.dealWarned'][] {
  return recentEvents(engine, 'broadcast.dealWarned').flatMap((event) =>
    event.type === 'broadcast.dealWarned' ? [event.payload] : [],
  );
}
