/**
 * Shared setup for the engine API tests: test queries, commands and streams declared the way a
 * system declares its own, a test system bundle that exercises the world, the RNG, events and
 * traces, and helpers to build engines over the shared fixture worlds.
 */

import { z } from 'zod';
import type { GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { cents, type Cents } from '../../../src/core/money';
import { intBetween } from '../../../src/core/rng/odds';
import { startCalc } from '../../../src/core/trace/calc';
import {
  createEngine,
  defineCommand,
  defineQuery,
  defineSubscription,
  defineSystem,
  initialEngineState,
  simSystem,
  type Engine,
  type EngineState,
  type SystemBundle,
  type Viewer,
} from '../../../src/core/api';
import type { GameWorld } from '../../../src/model/tables';
import { aNews } from '../../support/builders/inbox';

declare module '@ringside/engine' {
  interface StreamNames {
    'test.api': true;
  }
  interface DomainEventMap {
    'test.cashMoved': { promotionId: string; amount: number };
    'test.dayTicked': { date: string };
  }
  interface QueryMap {
    'test.cash': { args: { promotionId: PromotionId }; result: { cash: Cents } | null };
    'test.viewer': { args: Record<string, never>; result: Viewer };
    'test.mapResult': { args: Record<string, never>; result: { lookup: Record<string, number> } };
    'test.throws': { args: Record<string, never>; result: null };
  }
  interface CommandMap {
    'test.moveCash': {
      args: { promotionId: PromotionId; amount: number };
      result: { cash: Cents; roll: number };
    };
    'test.refuse': { args: Record<string, never>; result: null };
    'test.explode': { args: { promotionId: PromotionId }; result: null };
    'test.badResult': {
      args: { promotionId: PromotionId };
      result: { lookup: Record<string, number> };
    };
  }
}

/** The ref kind the test phase records its traces under. */
export const TEST_TRACE_KIND = 'test.dailyCash';

const noArgs = z.strictObject({});

/**
 * `test.moveCash` adds `amount` cents plus an RNG roll to a promotion's cash, records a trace and
 * publishes an event. `test.refuse` is always refused. `test.explode` writes, draws, publishes and
 * then throws.
 */
export const testCommands = [
  defineCommand('test.moveCash', {
    args: z.strictObject({
      promotionId: z.custom<PromotionId>((value) => typeof value === 'string'),
      amount: z.number().int().min(-1_000_000).max(1_000_000),
    }),
    validate: (read, args) =>
      read.tables.promotions.has(args.promotionId)
        ? []
        : [
            {
              code: 'unknownPromotion',
              message: 'That promotion does not exist.',
              field: 'promotionId',
            },
          ],
    apply: (ctx, args) => {
      const promotion = ctx.read.tables.promotions.require(args.promotionId);
      const roll = intBetween(ctx.rng('test.api'), 1, 100);
      const cash = cents(promotion.cash + args.amount + roll);
      ctx.tx.update('promotions', args.promotionId, { cash });
      ctx.publish('test.cashMoved', { promotionId: args.promotionId, amount: args.amount });
      ctx.recordTrace(
        { kind: 'test.moveCash', id: args.promotionId },
        ctx.date,
        startCalc('Cash', promotion.cash).add('Amount', args.amount).add('Roll', roll).done(),
      );
      return { cash, roll };
    },
  }),
  defineCommand('test.refuse', {
    args: noArgs,
    validate: () => [{ code: 'notToday', message: 'Not today.' }],
    apply: () => null,
  }),
  defineCommand('test.explode', {
    args: z.strictObject({
      promotionId: z.custom<PromotionId>((value) => typeof value === 'string'),
    }),
    apply: (ctx, args) => {
      intBetween(ctx.rng('test.api'), 1, 100);
      ctx.tx.update('promotions', args.promotionId, { cash: cents(0) });
      ctx.publish('test.cashMoved', { promotionId: args.promotionId, amount: 0 });
      throw new Error('The command blew up');
    },
  }),
  defineCommand('test.badResult', {
    args: z.strictObject({
      promotionId: z.custom<PromotionId>((value) => typeof value === 'string'),
    }),
    apply: (ctx, args) => {
      ctx.tx.update('promotions', args.promotionId, { cash: cents(0) });
      // Deliberately wrong: a Map does not survive the worker boundary.
      return { lookup: smuggleMap(new Map([['a', 1]])) };
    },
  }),
];

export const testQueries = [
  defineQuery('test.cash', {
    args: z.strictObject({
      promotionId: z.custom<PromotionId>((value) => typeof value === 'string'),
    }),
    run: (ctx, args) => {
      const promotion = ctx.read.tables.promotions.get(args.promotionId);
      return promotion === undefined ? null : { cash: promotion.cash };
    },
  }),
  defineQuery('test.viewer', { args: noArgs, run: (ctx) => ctx.viewer }),
  defineQuery('test.mapResult', {
    args: noArgs,
    // Deliberately wrong: a Map does not survive the worker boundary.
    run: () => ({ lookup: smuggleMap(new Map([['a', 1]])) }),
  }),
  defineQuery('test.throws', {
    args: noArgs,
    run: () => {
      throw new Error('The query blew up');
    },
  }),
];

/** Passes a Map off as a record, the way a buggy query would. */
function smuggleMap(map: Map<string, number>): Record<string, number> {
  const holder: { lookup: Record<string, number> } = { lookup: {} };
  Reflect.set(holder, 'lookup', map);
  return holder.lookup;
}

/**
 * A daily phase that moves every promotion's cash by an RNG roll, creates a news row (minting an
 * ID from the seeded RNG), records a trace and publishes an event; and a reaction that counts the
 * events into a second promotion field. Everything a determinism check needs to cover.
 */
export const testDailySystem: SystemBundle = defineSystem({
  id: 'testDaily',
  phases: [
    {
      id: 'testDaily.tick',
      group: 'money',
      order: 0,
      cadence: { kind: 'daily' },
      run: (ctx) => {
        for (const promotion of ctx.read.tables.promotions.values()) {
          const roll = intBetween(ctx.rng('test.api'), -500, 500);
          ctx.tx.update('promotions', promotion.id, { cash: cents(promotion.cash + roll) });
          ctx.recordTrace(
            { kind: TEST_TRACE_KIND, id: promotion.id },
            ctx.date,
            startCalc('Daily cash', promotion.cash).add('Roll', roll).done(),
          );
        }
        const news = aNews({ date: ctx.date });
        ctx.tx.create('news', {
          date: news.date,
          kind: news.kind,
          headline: news.headline,
          body: news.body,
          refs: news.refs,
          importance: news.importance,
          expiresOn: news.expiresOn,
          buzz: news.buzz,
          dedupeKey: news.dedupeKey,
        });
        ctx.publish('test.dayTicked', { date: ctx.date });
      },
    },
  ],
  subscriptions: [
    defineSubscription({
      id: 'testDaily.onTick',
      type: 'test.dayTicked',
      handler: (event, ctx) => {
        const first = ctx.read.tables.promotions.values()[0];
        if (first !== undefined) {
          ctx.tx.update('promotions', first.id, {
            prestige: event.payload.date === ctx.date ? Math.min(100, first.prestige + 1) : 0,
          });
        }
      },
    }),
  ],
});

/** The test queries and commands as a bundle. */
export const testApiSystem: SystemBundle = defineSystem({
  id: 'testApi',
  queries: testQueries,
  commands: testCommands,
});

/** Every test bundle plus the engine's own. */
export function testSystems(): SystemBundle[] {
  return [simSystem, testApiSystem, testDailySystem];
}

/** An engine over `world` (as a new game) with the test systems. */
export function engineFor(
  world: GameWorld,
  systems: readonly SystemBundle[] = testSystems(),
): Engine {
  return createEngine({ state: initialEngineState(world), systems });
}

/** A state through JSON and back, as a save would carry it. */
export function throughJson(state: EngineState): EngineState {
  const parsed: unknown = JSON.parse(JSON.stringify(state));
  // Test-only: the round trip keeps the shape; createEngine validates every part it rebuilds.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return parsed as EngineState;
}

/** The world's date, via the engine. */
export function clockDate(engine: Engine): GameDate {
  const clock = engine.query('clock.get', {}, { kind: 'omniscient' });
  if (!clock.ok) {
    throw new Error(`clock.get failed: ${JSON.stringify(clock.reasons)}`);
  }
  return clock.data.date;
}
