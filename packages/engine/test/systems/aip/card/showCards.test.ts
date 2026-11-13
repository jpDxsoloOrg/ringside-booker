// A promotion's shows with their cards (AIP4-06). Design: docs/design/rival-booking.md#show-cards
import { describe, expect, it } from 'vitest';
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { parseGameDate } from '../../../../src/core/date';
import type { EventInstanceId, PromotionId } from '../../../../src/core/ids';
import { runStep } from '../../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../../src/core/pipeline/runtime';
import type { EventInstance } from '../../../../src/model/entities/event-instance';
import {
  AIP_RUN_TURNS_PHASE_ID,
  CARD_HIDDEN_TEXT,
  CARD_PLAN_TRACE_KIND,
  CARD_SLOT_TRACE_KIND,
  runTurnsPhase,
  type ShowCardRow,
  type ShowCards,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { showScoreTraceRef } from '../../../../src/systems/shows';
import { anEventInstance, worldBuilder } from '../../../support';
import type { DeepPartial } from '../../../support/builders/build-row';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support/systems';
import { expectSerialisable } from '../../../support/trace';
import { promo, seed, singles } from '../../booking/command-world';
import { COMPUTER, OMNISCIENT, PLAYER_ONE } from '../../calendar/lifecycle-world';

const START = '2026-01-05';
const TODAY = parseGameDate('2026-01-06');
const NEXT_WEEK = parseGameDate('2026-01-13');
const SLOTS = 5;
const PLAYER: Viewer = controllerViewer(PLAYER_ONE);
const tunables = createEngineTunables();

interface CardsWorld {
  readonly engine: Engine;
  readonly proA: PromotionId;
  readonly proB: PromotionId;
  readonly proC: PromotionId;
  readonly shows: {
    /** A's show next week: a singles match in slot 2 and a promo in slot 5. */
    readonly own: EventInstanceId;
    /** B's show today, booked by the rival desk. */
    readonly rival: EventInstanceId;
    /** B's show next week. */
    readonly rivalNext: EventInstanceId;
    /** Thin C's show today, cancelled by the rival desk. */
    readonly thin: EventInstanceId;
  };
}

function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The cards world has no ${what}`);
  }
  return value;
}

/**
 * A (player-1, 14 wrestlers), B (computer, 12) and C (computer, 3). Today's rival shows have been
 * booked by `aip.runTurns`; the day has not been closed yet.
 */
function cardsWorld(options: { readonly sandbox?: boolean } = {}): CardsWorld {
  let shows: CardsWorld['shows'] | undefined;
  const alternating = {
    employment: (index: number) => ({
      alignment: index % 2 === 0 ? ('face' as const) : ('heel' as const),
    }),
  } as const;
  const built = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
    settings: { sandbox: options.sandbox ?? false },
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(14, alternating),
    )
    .withPromotion({ name: 'Test Promotion B', controller: COMPUTER }, (promotion) =>
      promotion.withRoster(12, alternating),
    )
    .withPromotion({ name: 'Test Promotion C', controller: COMPUTER }, (promotion) =>
      promotion.withRoster(3),
    )
    .with('shows', (context) => {
      const regionId = only(context.ids.regions[0], 'region');
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              brandId: null,
              regionId,
              format: { slots: SLOTS, preShowSlots: 1 },
              ...overrides,
            },
            context.sequence,
          ),
        ).id;
      shows = {
        own: add({
          promotionId: only(context.ids.promotions.A, 'A'),
          date: NEXT_WEEK,
          name: 'Own Weekly',
        }),
        rival: add({
          promotionId: only(context.ids.promotions.B, 'B'),
          date: TODAY,
          name: 'Rival Weekly',
        }),
        rivalNext: add({
          promotionId: only(context.ids.promotions.B, 'B'),
          date: NEXT_WEEK,
          name: 'Rival Next',
        }),
        thin: add({
          promotionId: only(context.ids.promotions.C, 'C'),
          date: TODAY,
          name: 'Thin Weekly',
        }),
      };
    })
    .build();
  const theShows = only(shows, 'shows');
  const [first, second, third] = built.ids.people;
  seed(built.world, theShows.own, 1, singles(only(first, 'a'), only(second, 'b')));
  seed(built.world, theShows.own, 4, promo(only(third, 'c')));

  const runtime = createRuntime({ world: built.world, tunables });
  const report = runStep(
    runtime,
    AIP_RUN_TURNS_PHASE_ID,
    { kind: 'phase', id: AIP_RUN_TURNS_PHASE_ID },
    runTurnsPhase.run,
    { date: TODAY },
  );
  expect(report.status, report.error?.message).toBe('ok');
  const engine = createEngine({
    state: { ...initialEngineState(runtime.world), traces: runtime.traces.toState() },
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
  return {
    engine,
    proA: only(built.ids.promotions.A, 'A'),
    proB: only(built.ids.promotions.B, 'B'),
    proC: only(built.ids.promotions.C, 'C'),
    shows: theShows,
  };
}

function cardsOf(engine: Engine, promotionId: PromotionId, viewer: Viewer): ShowCards {
  const result = engine.query('aip.showCards', { promotionId }, viewer);
  if (!result.ok) {
    throw new Error(`aip.showCards failed: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function rowOf(cards: ShowCards, id: EventInstanceId): ShowCardRow {
  return only(
    cards.rows.find((row) => row.eventInstanceId === id),
    `row ${id}`,
  );
}

function expectHidden(row: ShowCardRow): void {
  expect(row).toMatchObject({
    revealed: false,
    hiddenText: CARD_HIDDEN_TEXT,
    planTraceRef: null,
    score: null,
    scoreTraceRef: null,
    slots: [],
  });
}

/** Every key in `value`, nested ones included. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

describe('aip.showCards', () => {
  it("hides a rival's card booked today from a player, and reveals it the next day", async () => {
    const world = cardsWorld();
    const today = rowOf(cardsOf(world.engine, world.proB, PLAYER), world.shows.rival);
    expect(today.status).toBe('booked');
    expectHidden(today);

    const advanced = await world.engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    const after = rowOf(cardsOf(world.engine, world.proB, PLAYER), world.shows.rival);
    expect(after).toMatchObject({
      revealed: true,
      hiddenText: null,
      status: 'completed',
      statusLabel: 'Completed',
      planTraceRef: { kind: CARD_PLAN_TRACE_KIND, id: world.shows.rival },
    });
    expect(after.score).not.toBeNull();
    // EVT3 ran the booked card: its score has a Why?, and every segment was rated.
    expect(after.scoreTraceRef).toEqual(showScoreTraceRef(world.shows.rival));
    const rated = world.engine
      .exportState()
      .world.tables.segments.filter((segment) => segment.eventInstanceId === world.shows.rival);
    expect(rated.length).toBeGreaterThan(0);
    expect(rated.filter((segment) => segment.rating === null)).toEqual([]);
    const main = after.slots.filter((slot) => !slot.preShow);
    expect(main).toHaveLength(SLOTS);
    for (const slot of main) {
      const segment = only(slot.segment ?? undefined, 'segment');
      expect(segment.reasonTraceRef).toEqual({ kind: CARD_SLOT_TRACE_KIND, id: segment.segmentId });
      expect(segment.sides.length).toBeGreaterThan(0);
      expect(segment.label.length).toBeGreaterThan(0);
    }
  });

  it("carries AIP5's result and reasons on a revealed rival card, and none on the player's", async () => {
    const world = cardsWorld();
    await world.engine.advanceDays({ maxDays: 1 });
    const row = rowOf(cardsOf(world.engine, world.proB, PLAYER), world.shows.rival);
    const segments = row.slots.flatMap((slot) => (slot.segment === null ? [] : [slot.segment]));
    const matches = segments.filter((segment) => segment.kind === 'match');
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      const decision = only(match.decision ?? undefined, `decision of ${match.segmentId}`);
      expect(decision.segmentId).toBe(match.segmentId);
      expect(decision.eventInstanceId).toBe(world.shows.rival);
      expect(decision.reasonText.length).toBeGreaterThan(0);
      expect(['win', 'draw', 'noContest']).toContain(decision.winner.kind);
      expect(decision.titles.every((title) => title.actual !== 'pending')).toBe(true);
    }
    for (const angle of segments.filter((segment) => segment.kind === 'angle')) {
      expect(angle.decision).toBeNull();
    }
    const own = rowOf(cardsOf(world.engine, world.proA, PLAYER), world.shows.own);
    for (const slot of own.slots) {
      expect(slot.segment?.decision ?? null).toBeNull();
    }
  });

  it("always shows the player's own card, open slots included and an empty pre-show left out", () => {
    const world = cardsWorld();
    const row = rowOf(cardsOf(world.engine, world.proA, PLAYER), world.shows.own);
    expect(row).toMatchObject({
      revealed: true,
      hiddenText: null,
      status: 'scheduled',
      statusLabel: 'Coming up',
      planTraceRef: null,
    });
    expect(row.slots.map((slot) => [slot.preShow, slot.displayNumber, slot.roleLabel])).toEqual([
      [false, 1, 'Opener'],
      [false, 2, 'Midcard'],
      [false, 3, 'Midcard'],
      [false, 4, 'Semi-main'],
      [false, 5, 'Main event'],
    ]);
    expect(row.slots.map((slot) => slot.segment === null)).toEqual([
      true,
      false,
      true,
      true,
      false,
    ]);
    const match = only(row.slots[1]?.segment ?? undefined, 'match');
    expect(match).toMatchObject({
      kind: 'match',
      typeName: 'Singles',
      outcome: null,
      reasonTraceRef: null,
      titles: [],
      storylines: [],
    });
    expect(match.sides).toHaveLength(2);
    expect(match.label).toBe(match.sides.map((side) => side.name).join(' vs '));
    expect(match.sides[0]?.people[0]?.name).toBe(match.sides[0]?.name);
  });

  it('shows a rival pre-show slot once it is filled', async () => {
    const world = cardsWorld();
    await world.engine.advanceDays({ maxDays: 1 });
    const row = rowOf(cardsOf(world.engine, world.proB, PLAYER), world.shows.rival);
    const [first] = row.slots;
    expect(first).toMatchObject({ preShow: true, displayNumber: 1, role: 'preShow' });
    expect(first?.segment).not.toBeNull();
  });

  it('lets the all-seeing viewer and a sandbox game see a rival card on the day', () => {
    const world = cardsWorld();
    const omniscient = rowOf(cardsOf(world.engine, world.proB, OMNISCIENT), world.shows.rival);
    expect(omniscient.revealed).toBe(true);
    expect(omniscient.slots.filter((slot) => slot.segment !== null).length).toBeGreaterThan(0);

    const sandbox = cardsWorld({ sandbox: true });
    const shared = rowOf(cardsOf(sandbox.engine, sandbox.proB, PLAYER), sandbox.shows.rival);
    expect(shared.revealed).toBe(true);
    expect(shared.planTraceRef).toEqual({ kind: CARD_PLAN_TRACE_KIND, id: sandbox.shows.rival });
  });

  it('says an upcoming rival card is revealed when the show airs', () => {
    const world = cardsWorld();
    const cards = cardsOf(world.engine, world.proB, PLAYER);
    const next = rowOf(cards, world.shows.rivalNext);
    expect(next.statusLabel).toBe('Coming up');
    expectHidden(next);
    expect(next.hiddenText).toBe('Card is revealed when the show airs');
  });

  it("gives a cancelled show the planner's reason once it is revealed", async () => {
    const world = cardsWorld();
    const today = rowOf(cardsOf(world.engine, world.proC, PLAYER), world.shows.thin);
    expect(today).toMatchObject({
      status: 'cancelled',
      statusLabel: 'Cancelled',
      cancelledReason: 'Called off by the promotion',
      slots: [],
    });
    await world.engine.advanceDays({ maxDays: 1 });
    const after = rowOf(cardsOf(world.engine, world.proC, PLAYER), world.shows.thin);
    expect(after).toMatchObject({
      revealed: true,
      statusLabel: 'Cancelled',
      cancelledReason: 'Only 3 wrestlers available, needs 5',
      slots: [],
    });
  });

  it('lists past shows newest first, then upcoming ones soonest first, within the limits', async () => {
    const world = cardsWorld();
    await world.engine.advanceDays({ maxDays: 1 });
    const cards = cardsOf(world.engine, world.proB, PLAYER);
    expect(cards.promotion).toMatchObject({ id: world.proB, name: 'Test Promotion B' });
    expect(cards.rows.map((row) => row.eventInstanceId)).toEqual([
      world.shows.rival,
      world.shows.rivalNext,
    ]);
    const none = world.engine.query(
      'aip.showCards',
      { promotionId: world.proB, upcoming: 0 },
      PLAYER,
    );
    expect(none.ok && none.data.rows.map((row) => row.eventInstanceId)).toEqual([
      world.shows.rival,
    ]);
    expect(
      world.engine.query('aip.showCards', { promotionId: world.proB, past: 0 }, PLAYER).ok,
    ).toBe(false);
  });

  it('has no length or minutes anywhere', async () => {
    const world = cardsWorld();
    await world.engine.advanceDays({ maxDays: 1 });
    for (const promotionId of [world.proA, world.proB, world.proC]) {
      const keys = keysOf(cardsOf(world.engine, promotionId, OMNISCIENT));
      expect(keys.filter((key) => /minute|length/i.test(key))).toEqual([]);
    }
  });
});
