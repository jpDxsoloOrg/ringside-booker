/**
 * A test engine for the engine host and hook tests: the real `createEngine` over the shared tiny
 * fixture world (one promotion run by the human `player-1`), plus a small test system:
 *
 * - query `counter.get` and command `counter.increment` (refused for a negative amount);
 * - query `fakeEngine.viewer`, which hands back the viewer it ran for;
 * - query `fakeEngine.rows`, which smuggles a `Map` into row 3 to trip the plain-JSON check;
 * - a gate that stops a multi-day advance at the start of a chosen date, with an optional
 *   player-facing reason, subject and route hint;
 * - a phase that throws on a chosen date, so a step failure shows up in the advance result.
 *
 * The real show-day gate (`shows.tonight`, EVT2-09) is taken out unless a test asks for it:
 * player-1's weekly show would otherwise stop every skip that crosses it. Without it the show is
 * never run (only Run the show runs it) and the calendar closes it as Not run.
 *
 * `showChanges` hands `popularity.showChange` canned answers by show id (the gallery's fixtures in
 * `screens/dev-gallery/fixtures/popularityShowChange.ts`: a big televised show, a small untelevised
 * one, a weak one, a worldwide one and each status without a record); any other show gets the
 * real answer.
 */

import { z } from 'zod';
import {
  addDays,
  parseGameDate,
  createEngine,
  defineCommand,
  defineGate,
  definePhase,
  defineQuery,
  defineSystem,
  initialEngineState,
  SHOWS_TONIGHT_GATE_ID,
  showChangeQuery,
} from '@ringside/engine';
import type {
  CreateEngineOptions,
  Engine,
  EngineState,
  EventInstanceId,
  GameDate,
  GateHit,
  PersonId,
  PromotionId,
  ShowPopularityChangeView,
  SystemBundle,
  Viewer,
} from '@ringside/engine';
import {
  systemsWithoutGates,
  TEST_PLAYER_ID,
  TINY_WORLD_TODAY,
  tinyWorld,
  worldBuilder,
} from '@ringside/engine/testing';
import type { EngineFactory } from '@/worker/engineHost';

declare module '@ringside/engine' {
  interface QueryMap {
    'counter.get': { args: Record<string, never>; result: { value: number } };
    'fakeEngine.viewer': { args: Record<string, never>; result: Viewer };
    'fakeEngine.rows': { args: Record<string, never>; result: { rows: { contract: string }[] } };
  }
  interface CommandMap {
    'counter.increment': { args: { amount: number }; result: { value: number } };
  }
}

/** The gate's id, as it appears in `stoppedBy.hits`. */
export const FAKE_GATE_ID = 'fakeEngine.stopDay';

/** The reason the gate gives when no other is asked for. */
export const FAKE_GATE_REASON = 'Test stop day';

/** The id of the phase that throws on `failDate`, as it appears in an advance's failures. */
export const FAKE_FAILING_STEP_ID = 'fakeEngine.explode';

/** The message of the error the failing phase throws. */
export const FAKE_FAILURE_MESSAGE = 'The test phase broke on purpose';

/** The date the fake world starts on. */
export const FAKE_START_DATE: GameDate = TINY_WORLD_TODAY;

/** The tiny world's state as a new game. Every call builds a fresh copy. */
export function fakeEngineState(): EngineState {
  return initialEngineState(tinyWorld().world);
}

/** The date of the `dayNumber`-th day of an advance from the start (day 1 is the start date). */
export function fakeAdvanceDay(dayNumber: number): GameDate {
  return addDays(FAKE_START_DATE, dayNumber - 1);
}

/** The booking world's first day: a Friday. Its Thursday show is six days away. */
export const BOOKING_WORLD_START: GameDate = parseGameDate('2026-04-10');

/** What `bookingFakeState` builds: the state to install and the roster, in builder order. */
export interface BookingFakeWorld {
  readonly state: EngineState;
  /** Twelve wrestlers, all contracted to Test Promotion A. */
  readonly roster: readonly PersonId[];
}

/**
 * A world for the booking screen: Test Promotion A, run by the local player, with a roster of
 * twelve and "Test Weekly" on Thursdays (six main-card slots and a pre-show), and the computer's
 * Test Promotion B with a show of its own. The shipped catalogs are on it, so matches can be
 * booked. Stored shows appear after the first simulated day; the card starts empty, so tests
 * book what they need through the transport. The golden tiny world is left alone.
 */
export function bookingFakeState(): BookingFakeWorld {
  const THURSDAY = 3;
  const SATURDAY = 5;
  const { world, ids } = worldBuilder({
    worldName: 'Test Booking World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: BOOKING_WORLD_START,
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand A' })
          .withRoster(12)
          .withWeeklyShow(
            { name: 'Test Weekly', weekdays: [THURSDAY] },
            { format: { slots: 6, preShowSlots: 1 } },
          ),
    )
    .withPromotion({ name: 'Test Promotion B', shortName: 'TPB' }, (promotion) =>
      promotion.withWeeklyShow({ name: 'Test Rival Weekly', weekdays: [SATURDAY] }),
    )
    .build();
  return { state: initialEngineState(world), roster: ids.people.slice(0, 12) };
}

/** The show-cards world's first day: its rival shows are on it, still to be booked and run. */
export const SHOW_CARDS_WORLD_START: GameDate = parseGameDate('2026-01-06');

/** What `aipShowCardsFakeState` builds. */
export interface ShowCardsFakeWorld {
  readonly state: EngineState;
  readonly promotions: {
    /** Test Promotion A, run by the local player. */
    readonly own: PromotionId;
    /** Test Promotion B, the computer's, with fourteen wrestlers and a champion. */
    readonly rival: PromotionId;
    /** Test Promotion C, the computer's, with three wrestlers: too few for a card. */
    readonly thin: PromotionId;
  };
}

/**
 * A world for the Shows tab (AIP4-07): the player's Test Promotion A, and two computer-run rivals
 * with shows on the first day, "Rival Weekly" (Test Promotion B, six slots, a title on the roster)
 * and "Thin Weekly" (Test Promotion C, three wrestlers), plus B's "Rival Next" a week later. Advance
 * one day and B's show has been booked by the rival desk, run and revealed, C's has been cancelled
 * for want of wrestlers, and "Rival Next" is still to come. The golden tiny world is left alone.
 */
export function aipShowCardsFakeState(): ShowCardsFakeWorld {
  const alternating = {
    employment: (index: number) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }) as const,
  };
  const show = (name: string, date: GameDate) =>
    ({
      name,
      date,
      airDate: date,
      brandId: null,
      importance: 'regular',
      format: { slots: 6, preShowSlots: 0 },
    }) as const;
  const { world, ids } = worldBuilder({
    worldName: 'Test Show Cards World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: SHOW_CARDS_WORLD_START,
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) => promotion.withRoster(12, alternating),
    )
    .withPromotion({ name: 'Test Promotion B', shortName: 'TPB' }, (promotion) =>
      promotion.withRoster(14, alternating).withTitle({ name: 'Test Rival Title' }, { holder: 0 }),
    )
    .withPromotion({ name: 'Test Promotion C', shortName: 'TPC' }, (promotion) =>
      promotion.withRoster(3),
    )
    .withEventInstance(show('Rival Weekly', SHOW_CARDS_WORLD_START), 'B')
    .withEventInstance(show('Rival Next', addDays(SHOW_CARDS_WORLD_START, 7)), 'B')
    .withEventInstance(show('Thin Weekly', SHOW_CARDS_WORLD_START), 'C')
    .build();
  const { A: own, B: rival, C: thin } = ids.promotions;
  if (own === undefined || rival === undefined || thin === undefined) {
    throw new Error('The show-cards world lost a promotion.');
  }
  return { state: initialEngineState(world), promotions: { own, rival, thin } };
}

export interface FakeEngineOptions {
  /** Keeps the real show-day gate. Off when left out. */
  readonly showDayGate?: boolean;
  /** A multi-day advance stops at the start of this date. Never, when left out. */
  readonly gateDate?: GameDate;
  /** What the gate's hit says and links to. The reason is {@link FAKE_GATE_REASON} by default. */
  readonly gateHit?: Partial<Pick<GateHit, 'reason' | 'subject' | 'actionHint'>>;
  /** The test phase throws while simulating this date. Never, when left out. */
  readonly failDate?: GameDate;
  /** Canned `popularity.showChange` answers by show id; other shows get the real answer. */
  readonly showChanges?: ReadonlyMap<EventInstanceId, ShowPopularityChangeView>;
}

const noArgs = z.strictObject({});

/** Puts a Map where the type says a string goes, the way a buggy query would. */
function smuggleMap(row: { contract: string }): { contract: string } {
  Reflect.set(row, 'contract', new Map([['wage', 1]]));
  return row;
}

/** The test system. The counter lives in the closure, one per engine. */
function fakeSystem(options: FakeEngineOptions): SystemBundle {
  let counter = 0;
  return defineSystem({
    id: 'fakeEngine',
    queries: [
      defineQuery('counter.get', { args: noArgs, run: () => ({ value: counter }) }),
      defineQuery('fakeEngine.viewer', { args: noArgs, run: (ctx) => ctx.viewer }),
      defineQuery('fakeEngine.rows', {
        args: noArgs,
        run: () => ({
          rows: [
            { contract: 'a' },
            { contract: 'b' },
            { contract: 'c' },
            smuggleMap({ contract: 'd' }),
          ],
        }),
      }),
    ],
    commands: [
      defineCommand('counter.increment', {
        args: z.strictObject({ amount: z.number().int() }),
        validate: (_read, args) =>
          args.amount >= 0
            ? []
            : [
                {
                  code: 'negativeAmount',
                  message: 'The counter only goes up.',
                  field: 'amount',
                },
              ],
        apply: (_ctx, args) => {
          counter += args.amount;
          return { value: counter };
        },
      }),
    ],
    phases: [
      definePhase({
        id: FAKE_FAILING_STEP_ID,
        group: 'housekeeping',
        order: 90,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (ctx.date === options.failDate) throw new Error(FAKE_FAILURE_MESSAGE);
        },
      }),
    ],
    gates: [
      defineGate({
        id: FAKE_GATE_ID,
        label: 'Test stop day',
        check: (_view, date) =>
          date === options.gateDate
            ? { reason: FAKE_GATE_REASON, ...options.gateHit, gateId: FAKE_GATE_ID }
            : null,
      }),
    ],
  });
}

/** `popularity.showChange` answering the canned shows first, then asking the real query. */
function withShowChanges(
  systems: readonly SystemBundle[],
  showChanges: ReadonlyMap<EventInstanceId, ShowPopularityChangeView> | undefined,
): readonly SystemBundle[] {
  if (showChanges === undefined) return systems;
  const canned = defineQuery('popularity.showChange', {
    args: showChangeQuery.args,
    run: (ctx, args) => showChanges.get(args.eventInstanceId) ?? showChangeQuery.run(ctx, args),
  });
  return systems.map((system) =>
    system.queries.includes(showChangeQuery)
      ? {
          ...system,
          queries: system.queries.map((query) => (query === showChangeQuery ? canned : query)),
        }
      : system,
  );
}

/** An engine factory that adds the test system to whatever the host asks for. */
export function fakeEngineFactory(options: FakeEngineOptions = {}): EngineFactory {
  return (engineOptions: CreateEngineOptions): Engine => {
    const gated =
      options.showDayGate === true
        ? engineOptions.systems
        : systemsWithoutGates(engineOptions.systems, [SHOWS_TONIGHT_GATE_ID]);
    const systems = withShowChanges(gated, options.showChanges);
    return createEngine({ ...engineOptions, systems: [...systems, fakeSystem(options)] });
  };
}
