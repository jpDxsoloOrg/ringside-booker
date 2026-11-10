/**
 * The world the calendar query tests share. It starts on Monday 5 January 2026 with the opening
 * 90 days already stored, the way a new game has them:
 *
 * - promotion A is run by `player-1` and has one brand, which runs a weekly Monday show;
 * - promotion B is run by the computer. It has a monthly special on the last Sunday, held at a
 *   venue only B may book, and a Friday show that stops running on 20 April;
 * - promotion C is dormant and has a weekly show that never runs;
 * - `player-2` is in the game and runs nothing.
 */

import {
  createEngine,
  initialEngineState,
  type Engine,
  type QueryArgs,
  type QueryData,
  type QueryName,
  type Viewer,
} from '../../../src/core/api';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type {
  BrandId,
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import { definitionAirDateKey } from '../../../src/model/entities/event-instance';
import { defaultSystems } from '../../../src/systems';
import { scheduleAll } from '../../../src/systems/calendar';
import {
  anEventDefinition,
  aVenue,
  worldBuilder,
  type BuildContext,
  type BuiltWorld,
} from '../../support';

export const PLAYER_ONE: Controller = { kind: 'human', playerId: 'player-1' };
export const PLAYER_TWO: Controller = { kind: 'human', playerId: 'player-2' };
export const COMPUTER: Controller = { kind: 'computer' };

export const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
export const AS_PLAYER_TWO: Viewer = { kind: 'controller', controller: PLAYER_TWO };
export const AS_COMPUTER: Viewer = { kind: 'controller', controller: COMPUTER };
export const OMNISCIENT: Viewer = { kind: 'omniscient' };

export function gameDate(value: string): GameDate {
  return parseGameDate(value);
}

/** A Monday. */
export const START = gameDate('2026-01-05');
export const HORIZON_DAYS = 90;
/** Sunday 5 April 2026: the last day stored at the start. */
export const HORIZON_END = addDays(START, HORIZON_DAYS);
/** The day promotion B's Friday show stops running. */
export const FRIDAY_SHOW_ENDS = gameDate('2026-04-20');

export interface CalendarHandles {
  readonly promotionA: PromotionId;
  readonly promotionB: PromotionId;
  readonly promotionC: PromotionId;
  readonly brandA: BrandId;
  /** Promotion A's weekly Monday show. */
  readonly weekly: EventDefinitionId;
  /** Promotion B's special on the last Sunday of the month. */
  readonly monthly: EventDefinitionId;
  /** Promotion B's Friday show, which ends on {@link FRIDAY_SHOW_ENDS}. */
  readonly friday: EventDefinitionId;
  /** The venue only promotion B may book, in the third region. */
  readonly rivalVenue: VenueId;
  readonly rivalRegion: RegionId;
  readonly homeRegion: RegionId;
}

export interface CalendarWorldOptions {
  /** Today, when it is later than the start date. */
  readonly currentDate?: string;
}

/** Adds a test's own rows after the opening schedule is stored, and returns what to keep. */
export type Extra<Kept> = (context: BuildContext, handles: CalendarHandles) => Kept;

function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) {
    throw new Error(`The calendar world is missing ${what}`);
  }
  return value;
}

/** The stored show of `definitionId` airing on `date`, in a world still being built. */
export function storedShowId(
  context: BuildContext,
  definitionId: EventDefinitionId,
  date: GameDate,
): EventInstanceId {
  const show = context.tx.view.tables.eventInstances.lookupOne(
    'byDefinitionAirDate',
    definitionAirDateKey(definitionId, date),
  );
  return required(show, `a show of ${definitionId} on ${date}`).id;
}

export function calendarWorldWith<Kept>(
  extra: Extra<Kept>,
  options: CalendarWorldOptions = {},
): BuiltWorld & CalendarHandles & { readonly kept: Kept } {
  const results: { handles: CalendarHandles; kept: Kept }[] = [];
  const built = worldBuilder({
    startDate: START,
    ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate }),
    players: [
      { playerId: 'player-1', displayName: 'Test Player 1' },
      { playerId: 'player-2', displayName: 'Test Player 2' },
    ],
  })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Brand One' })
        .withWeeklyShow({ name: 'Test Weekly', weekdays: [0] }),
    )
    .withPromotion({ name: 'Test Promotion B' })
    .withPromotion({ name: 'Test Promotion C', status: 'dormant' }, (promotion) =>
      promotion.withWeeklyShow({ name: 'Test Dormant Weekly', weekdays: [2] }),
    )
    .with('calendar', (context) => {
      const { promotions, brands, regions, eventDefinitions } = context.ids;
      const promotionB = required(promotions.B, 'promotion B');
      const rivalRegion = required(regions[2], 'a third region');
      const rivalVenue = context.insert(
        'venues',
        aVenue(
          {
            name: 'Test Rival Arena',
            regionId: rivalRegion,
            capacity: 12_000,
            kind: 'arena',
            exclusivePromotionId: promotionB,
          },
          context.sequence,
        ),
      ).id;
      const monthly = context.insert(
        'eventDefinitions',
        anEventDefinition(
          {
            promotionId: promotionB,
            name: 'Test Monthly Special',
            importance: 'major',
            recurrence: { kind: 'monthly', week: 'last', weekday: 6 },
            format: { slots: 8, preShowSlots: 1 },
            televised: false,
            preferredVenueId: rivalVenue,
            activeFrom: START,
          },
          context.sequence,
        ),
      ).id;
      const friday = context.insert(
        'eventDefinitions',
        anEventDefinition(
          {
            promotionId: promotionB,
            name: 'Test Friday Show',
            importance: 'minor',
            recurrence: { kind: 'weekly', weekdays: [4] },
            activeFrom: START,
            activeUntil: FRIDAY_SHOW_ENDS,
          },
          context.sequence,
        ),
      ).id;
      scheduleAll(context.tx, context.tx.view, START, HORIZON_END);
      const handles: CalendarHandles = {
        promotionA: required(promotions.A, 'promotion A'),
        promotionB,
        promotionC: required(promotions.C, 'promotion C'),
        brandA: required(brands[0], 'a brand'),
        weekly: required(eventDefinitions[0], 'the weekly show'),
        monthly,
        friday,
        rivalVenue,
        rivalRegion,
        homeRegion: required(regions[0], 'a first region'),
      };
      results.push({ handles, kept: extra(context, handles) });
    })
    .build();
  const [result] = results;
  if (result === undefined) {
    throw new Error('The calendar world was built without its handles');
  }
  return { ...built, ...result.handles, kept: result.kept };
}

export function calendarWorld(options: CalendarWorldOptions = {}): BuiltWorld & CalendarHandles {
  return calendarWorldWith(() => null, options);
}

export function engineOver(
  built: BuiltWorld,
  tunableOverrides: Record<string, number> = {},
): Engine {
  return createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides },
    systems: defaultSystems,
  });
}

/** Runs a query and returns its data, failing the test if it was refused. */
export function ask<Name extends QueryName>(
  engine: Engine,
  name: Name,
  args: QueryArgs<Name>,
  viewer: Viewer,
): QueryData<Name> {
  const result = engine.query(name, args, viewer);
  if (!result.ok) {
    throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** Advances `days` days and fails the test if any step failed. */
export async function advance(engine: Engine, days: number): Promise<void> {
  const result = await engine.advanceDays({ maxDays: days });
  if (result.failures.length > 0 || result.daysAdvanced !== days) {
    throw new Error(`The advance did not run cleanly: ${JSON.stringify(result)}`);
  }
}
