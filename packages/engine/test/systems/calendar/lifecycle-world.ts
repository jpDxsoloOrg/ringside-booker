/**
 * The world the show lifecycle tests share: who controls which show.
 *
 * - promotion A is run by `player-1`. Its first brand has no controller of its own, so the
 *   promotion's controller runs it. Its second brand is run by `player-2`;
 * - promotion B is run by the computer;
 * - `player-3` is in the game and runs nothing.
 */

import {
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { DomainEventMap } from '../../../src/core/events/types';
import type { BrandId, EventInstanceId, PromotionId } from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import {
  anEventInstance,
  SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  worldBuilder,
  type BuildContext,
  type BuiltWorld,
} from '../../support';

export const PLAYER_ONE: Controller = { kind: 'human', playerId: 'player-1' };
export const PLAYER_TWO: Controller = { kind: 'human', playerId: 'player-2' };
export const PLAYER_THREE: Controller = { kind: 'human', playerId: 'player-3' };
export const COMPUTER: Controller = { kind: 'computer' };
export const OMNISCIENT = { kind: 'omniscient' } as const;

/** A Monday. The world's weekly show, when it has one, runs on Mondays. */
export const LIFECYCLE_START = '2026-01-05';

export interface LifecycleHandles {
  readonly promotionA: PromotionId;
  readonly promotionB: PromotionId;
  /** Promotion A's first brand: no controller of its own. */
  readonly sharedBrand: BrandId;
  /** Promotion A's second brand, run by `player-2`. */
  readonly rivalBrand: BrandId;
}

export interface LifecycleOptions {
  /** Today, when it is later than the start date. */
  readonly currentDate?: string;
  /** Gives promotion A a weekly Monday show, so the daily horizon has something to schedule. */
  readonly weeklyShow?: boolean;
}

/** Inserts one show into the world being built and returns its id. */
export type AddShow = (overrides: Parameters<typeof anEventInstance>[0]) => EventInstanceId;

/** Adds a test's own rows and returns what the test wants to keep, usually the show ids. */
export type AddShows<Kept> = (
  addShow: AddShow,
  handles: LifecycleHandles,
  context: BuildContext,
) => Kept;

function handlesOf(context: BuildContext): LifecycleHandles {
  const { promotions, brands } = context.ids;
  const [sharedBrand, rivalBrand] = brands;
  if (
    promotions.A === undefined ||
    promotions.B === undefined ||
    sharedBrand === undefined ||
    rivalBrand === undefined
  ) {
    throw new Error('The lifecycle world is missing a promotion or a brand');
  }
  return { promotionA: promotions.A, promotionB: promotions.B, sharedBrand, rivalBrand };
}

/** The lifecycle world plus the test's own shows; `shows` is whatever `addShows` returned. */
export function lifecycleWorldWith<Kept>(
  addShows: AddShows<Kept>,
  options: LifecycleOptions = {},
): BuiltWorld & LifecycleHandles & { readonly shows: Kept } {
  const kept: { handles: LifecycleHandles; shows: Kept }[] = [];
  const built = worldBuilder({
    startDate: LIFECYCLE_START,
    ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate }),
    players: [
      { playerId: 'player-1', displayName: 'Test Player 1' },
      { playerId: 'player-2', displayName: 'Test Player 2' },
      { playerId: 'player-3', displayName: 'Test Player 3' },
    ],
  })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) => {
      promotion
        .withBrand({ name: 'Test Brand One' })
        .withBrand({ name: 'Test Brand Two', controller: PLAYER_TWO });
      if (options.weeklyShow === true) {
        promotion.withWeeklyShow({ name: 'Test Weekly', weekdays: [0] });
      }
    })
    .withPromotion({ name: 'Test Promotion B' })
    .with('shows', (context) => {
      const handles = handlesOf(context);
      const shows = addShows(
        (overrides) =>
          context.insert('eventInstances', anEventInstance(overrides, context.sequence)).id,
        handles,
        context,
      );
      kept.push({ handles, shows });
    })
    .build();
  const [result] = kept;
  if (result === undefined) {
    throw new Error('The lifecycle world was built without its handles');
  }
  return { ...built, ...result.handles, shows: result.shows };
}

/** The lifecycle world with no shows. */
export function lifecycleWorld(options: LifecycleOptions = {}): BuiltWorld & LifecycleHandles {
  return lifecycleWorldWith(() => null, options);
}

// The show-day gate would stop every day with the player's unbooked show; these tests are about
// the calendar, so they run without it. booking/gate.test.ts covers the gate.
export function engineOver(built: BuiltWorld): Engine {
  return createEngine({
    state: initialEngineState(built.world),
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
}

/** Advances `days` days and fails the test if any step failed. Returns the state afterwards. */
export async function advance(engine: Engine, days: number): Promise<EngineState> {
  const result = await engine.advanceDays({ maxDays: days });
  if (result.failures.length > 0 || result.daysAdvanced !== days) {
    throw new Error(`The advance did not run cleanly: ${JSON.stringify(result)}`);
  }
  return engine.exportState();
}

export function showIn(state: EngineState, id: EventInstanceId): EventInstance {
  const show = state.world.tables.eventInstances.find((row) => row.id === id);
  if (show === undefined) {
    throw new Error(`No show ${id} in the state`);
  }
  return show;
}

/** The payload of every `show.cancelled` in the recent-event log, oldest first. */
export function cancelledEvents(engine: Engine): DomainEventMap['show.cancelled'][] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['show.cancelled'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.flatMap((event) => (event.type === 'show.cancelled' ? [event.payload] : []));
}

export function gameDate(value: string): GameDate {
  return parseGameDate(value);
}
