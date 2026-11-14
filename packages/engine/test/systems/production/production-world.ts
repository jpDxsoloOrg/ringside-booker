/**
 * A world for the production command and query tests (ECO7-02), on the mini geography, dated
 * Monday 5 Jan 2026 unless `today` says otherwise.
 *
 * - A "Hardpan": human-controlled, Hardpan's levels (camera 2, marketing 1, back office 1),
 *   $100,000 cash, popularity 40 in North 1 and 10 in North 2 (ceiling 30). A weekly minor show
 *   "Hardpan Friday".
 * - B "Rival": computer-controlled, Altura's levels, $5,000,000.
 * - `deal`: when asked for, A's active deal with "Channel 9" from 5 Jan for `dealDays` days.
 */

import type { Controller } from '../../../src/model/controller';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, parseGameDate } from '../../../src/core/date';
import type { DealId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { DeepPartial } from '../../support/builders/build-row';
import type { Promotion } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { financeSystem } from '../../../src/systems/finance';
import { productionSystem } from '../../../src/systems/production';
import {
  aDeal,
  aLedgerEntry,
  aNetwork,
  anEventDefinition,
  TEST_PLAYER_ID,
  worldBuilder,
} from '../../support';
import type { LedgerCategory } from '../../../src/model/entities/ledger-entry';
import { ALTURA, HARDPAN } from './support';

export const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
export const OTHER_PLAYER: Controller = { kind: 'human', playerId: 'player-2' };
export const COMPUTER: Controller = { kind: 'computer' };

export const START = parseGameDate('2026-01-05');

export interface ProductionWorldOptions {
  /** The game's current date, 2026-01-05 (a Monday) by default. */
  readonly today?: string;
  /** Give A an active TV deal running this many days from 5 Jan. */
  readonly dealDays?: number;
  /** Give A its weekly Friday minor show (default true). */
  readonly weeklyShow?: boolean;
  readonly human?: DeepPartial<Promotion>;
  /** Ledger rows to give A (ECO7-06's cash runway reads them). */
  readonly ledger?: readonly { date: string; category: LedgerCategory; amount: number }[];
}

export interface ProductionWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly deal: DealId | null;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`productionWorld: missing ${what}`);
  }
  return value;
}

export function productionWorld(options: ProductionWorldOptions = {}): ProductionWorld {
  let deal: DealId | null = null;
  const built = worldBuilder({
    startDate: '2026-01-05',
    currentDate: options.today ?? '2026-01-05',
  })
    .withGeography('mini')
    .withPromotion({
      name: 'Hardpan',
      controller: PLAYER,
      production: HARDPAN,
      cash: cents(10_000_000),
      ...options.human,
    })
    .withPromotion({
      name: 'Rival',
      controller: COMPUTER,
      production: ALTURA,
      cash: cents(500_000_000),
    })
    .with('production', (context) => {
      const human = required(context.ids.promotions.A, 'A');
      const north1 = required(context.ids.regions[0], 'North 1');
      const north2 = required(context.ids.regions[1], 'North 2');
      context.tx.update('promotions', human, {
        regionalPop: { [north1]: 40, [north2]: 10 },
      });
      if (options.weeklyShow !== false) {
        context.insert(
          'eventDefinitions',
          anEventDefinition(
            {
              promotionId: human,
              name: 'Hardpan Friday',
              importance: 'minor',
              recurrence: { kind: 'weekly', weekdays: [4] },
              activeFrom: START,
            },
            context.sequence,
          ),
        );
      }
      for (const row of options.ledger ?? []) {
        context.insert(
          'ledgerEntries',
          aLedgerEntry(
            {
              promotionId: human,
              date: parseGameDate(row.date),
              category: row.category,
              amount: cents(row.amount),
            },
            context.sequence,
          ),
        );
      }
      if (options.dealDays !== undefined) {
        const network = context.insert(
          'networks',
          aNetwork(
            {
              name: 'Channel 9',
              coverage: { regionIds: [north1] },
              launchedOn: parseGameDate('2020-01-01'),
            },
            context.sequence,
          ),
        );
        deal = context.insert(
          'deals',
          aDeal(
            {
              networkId: network.id,
              promotionId: human,
              startsOn: START,
              endsOn: addDays(START, options.dealDays),
            },
            context.sequence,
          ),
        ).id;
      }
    })
    .build();
  return {
    world: built.world,
    human: required(built.ids.promotions.A, 'A'),
    rival: required(built.ids.promotions.B, 'B'),
    deal,
  };
}

/** An engine with the sim, finance and production systems over `world`. */
export function productionEngine(world: GameWorld, overrides: TunableOverrides = {}): Engine {
  return createEngine({
    state: { ...initialEngineState(world), tunableOverrides: overrides },
    systems: [simSystem, financeSystem, productionSystem],
  });
}
