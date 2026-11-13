// Auto-fill on the player's own card (AIP4-06). Design: docs/design/rival-booking.md#auto-fill
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { parseGameDate } from '../../../../src/core/date';
import type { EventInstanceId, PersonId, SegmentId } from '../../../../src/core/ids';
import type { EventInstance } from '../../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../../src/model/tables';
import {
  CARD_FULL_MESSAGE,
  CARD_SLOT_TRACE_KIND,
  NO_CATALOG_MESSAGE,
  type AutoFillResult,
} from '../../../../src/systems/aip';
import { anEventInstance, worldBuilder } from '../../../support';
import type { DeepPartial } from '../../../support/builders/build-row';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support/systems';
import { expectSerialisable } from '../../../support/trace';
import { promo, seed, singles } from '../../booking/command-world';
import { COMPUTER, OMNISCIENT, PLAYER_ONE, PLAYER_TWO } from '../../calendar/lifecycle-world';

const START = '2026-01-05';
const TODAY = parseGameDate('2026-01-06');
const NEXT_WEEK = parseGameDate('2026-01-13');
const SLOTS = 5;

type ShowName = 'open' | 'full' | 'past' | 'completed' | 'cancelled' | 'rival';

interface FillWorld {
  readonly world: GameWorld;
  readonly shows: Readonly<Record<ShowName, EventInstanceId>>;
  readonly roster: readonly PersonId[];
}

function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The Auto-fill world has no ${what}`);
  }
  return value;
}

/**
 * Promotion A (player-1, `rosterSize` wrestlers) and the computer's B (12). A has an open show next
 * week, a full one, one from yesterday, a completed and a cancelled one; B has a show today. Every
 * show has 5 main-card slots and a pre-show slot.
 */
function fillWorld(rosterSize = 14, catalogs = true): FillWorld {
  let shows: Record<ShowName, EventInstanceId> | undefined;
  const alternating = {
    employment: (index: number) => ({
      alignment: index % 2 === 0 ? ('face' as const) : ('heel' as const),
    }),
  } as const;
  const builder = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [
      { playerId: 'player-1', displayName: 'Test Player 1' },
      { playerId: 'player-2', displayName: 'Test Player 2' },
    ],
  });
  const { world, ids } = (catalogs ? builder.withCatalogs() : builder)
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(rosterSize, alternating),
    )
    .withPromotion({ name: 'Test Promotion B', controller: COMPUTER }, (promotion) =>
      promotion.withRoster(12, alternating),
    )
    .with('shows', (context) => {
      const promotionA = only(context.ids.promotions.A, 'promotion A');
      const promotionB = only(context.ids.promotions.B, 'promotion B');
      const regionId = only(context.ids.regions[0], 'region');
      const add = (overrides: DeepPartial<EventInstance>): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: promotionA,
              brandId: null,
              regionId,
              date: NEXT_WEEK,
              format: { slots: SLOTS, preShowSlots: 1 },
              ...overrides,
            },
            context.sequence,
          ),
        ).id;
      shows = {
        open: add({ name: 'Test Open Show' }),
        full: add({ name: 'Test Full Show' }),
        past: add({ date: parseGameDate(START) }),
        completed: add({ date: parseGameDate(START), status: 'completed' }),
        cancelled: add({ status: 'cancelled' }),
        rival: add({ promotionId: promotionB, date: TODAY, name: 'Rival Weekly' }),
      };
    })
    .build();
  const built = { world, shows: only(shows, 'shows'), roster: ids.people.slice(0, rosterSize) };
  if (catalogs) {
    // The full show: a promo in every slot, each by someone else.
    const person = (index: number) =>
      only(built.roster[index % rosterSize], `wrestler ${String(index)}`);
    for (let slot = 0; slot < SLOTS; slot++) {
      seed(world, built.shows.full, slot, promo(person(slot)));
    }
    seed(world, built.shows.full, 0, promo(person(SLOTS)), true);
  }
  return built;
}

function engineFor(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
}

function applied(result: { ok: true; data: AutoFillResult } | { ok: false; reasons: unknown }) {
  if (!result.ok) {
    throw new Error(`Auto-fill was refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function segmentsOn(engine: Engine, eventInstanceId: EventInstanceId) {
  return engine
    .exportState()
    .world.tables.segments.filter((segment) => segment.eventInstanceId === eventInstanceId);
}

describe('aip.autoFillCard', () => {
  it('fills only the open slots, keeps what is there and plans no winner', () => {
    const built = fillWorld();
    const kept = [
      seed(
        built.world,
        built.shows.open,
        1,
        singles(only(built.roster[0], 'a'), only(built.roster[1], 'b')),
      ),
      seed(built.world, built.shows.open, 3, promo(only(built.roster[2], 'c'))),
    ];
    const engine = engineFor(built.world);
    const result = applied(
      engine.command('aip.autoFillCard', { eventInstanceId: built.shows.open }, PLAYER_ONE),
    );
    expect(result.kept).toBe(2);
    expect(result.message).toBeNull();
    const after = segmentsOn(engine, built.shows.open);
    for (const id of kept) {
      expect(after.find((segment) => segment.id === id)).toBeDefined();
    }
    expect(after.find((segment) => segment.id === kept[0])).toMatchObject({ slot: 1 });
    expect(after.find((segment) => segment.id === kept[1])).toMatchObject({ slot: 3 });
    expect(result.filled.length + result.open.length).toBe(SLOTS - 2 + 1);
    expect(after).toHaveLength(2 + result.filled.length);
    // Never a planned winner.
    for (const segment of after) {
      if (segment.kind === 'match') {
        expect(segment.outcome).toBeNull();
      }
    }
    // Nobody wrestles twice: the kept match's wrestlers are not used again (a speaker may be).
    const participants = engine
      .exportState()
      .world.tables.participants.filter((row) =>
        result.filled.some((slot) => slot.segmentId === row.segmentId),
      )
      .map((row) => row.personId);
    expect(participants).not.toContain(built.roster[0]);
    expect(participants).not.toContain(built.roster[1]);
    // Every filled slot has a reason and a Why?.
    for (const slot of result.filled) {
      expect(slot.headline.length).toBeGreaterThan(0);
      expect(slot.label.length).toBeGreaterThan(0);
      expect(slot.roleLabel.length).toBeGreaterThan(0);
      expect(slot.traceRef).toEqual({ kind: CARD_SLOT_TRACE_KIND, id: slot.segmentId });
      const trace = engine.query('trace.get', { ref: slot.traceRef }, OMNISCIENT);
      expect(trace.ok && trace.data !== null).toBe(true);
    }
    // One card.changed per written segment.
    const changes = engine.query(
      'sim.recentEvents',
      { limit: 100, types: ['card.changed'] },
      OMNISCIENT,
    );
    if (!changes.ok) {
      throw new Error('sim.recentEvents failed');
    }
    const payloads = changes.data.flatMap((event) =>
      event.type === 'card.changed' ? [event.payload] : [],
    );
    expect(
      payloads.map((payload) => [payload.eventInstanceId, payload.segmentId, payload.change]),
    ).toEqual(result.filled.map((slot) => [built.shows.open, slot.segmentId, 'added']));
  });

  it('rebuilds the whole card when asked, announcing the clear first', () => {
    const built = fillWorld();
    const old: SegmentId = seed(
      built.world,
      built.shows.open,
      0,
      singles(only(built.roster[0], 'a'), only(built.roster[1], 'b'), {
        kind: 'draw',
      }),
    );
    const engine = engineFor(built.world);
    const result = applied(
      engine.command(
        'aip.autoFillCard',
        { eventInstanceId: built.shows.open, keepFilledSlots: false },
        PLAYER_ONE,
      ),
    );
    expect(result.kept).toBe(0);
    const after = segmentsOn(engine, built.shows.open);
    expect(after.find((segment) => segment.id === old)).toBeUndefined();
    expect(after.filter((segment) => !segment.preShow)).toHaveLength(SLOTS);
    for (const segment of after) {
      if (segment.kind === 'match') {
        expect(segment.outcome).toBeNull();
      }
    }
    const changes = engine.query(
      'sim.recentEvents',
      { limit: 100, types: ['card.changed'] },
      OMNISCIENT,
    );
    if (!changes.ok) {
      throw new Error('sim.recentEvents failed');
    }
    const kinds = changes.data.map((event) =>
      event.type === 'card.changed' ? event.payload.change : null,
    );
    expect(kinds[0]).toBe('cleared');
    expect(kinds.slice(1)).toEqual(result.filled.map(() => 'added'));
  });

  it.each([
    [
      'rival',
      PLAYER_ONE,
      'notYourShow',
      'Only the person running Test Promotion B can book this show',
    ],
    [
      'open',
      PLAYER_TWO,
      'notYourShow',
      'Only the person running Test Promotion A can book this show',
    ],
    ['past', PLAYER_ONE, 'showPast', 'This show has already happened'],
    ['completed', PLAYER_ONE, 'showCompleted', 'This show has already run'],
    ['cancelled', PLAYER_ONE, 'showCancelled', 'This show was cancelled'],
    ['full', PLAYER_ONE, 'cardFull', CARD_FULL_MESSAGE],
  ] as const)('refuses the %s show for %o with %s', (show, issuedBy, code, message) => {
    const built = fillWorld();
    const engine = engineFor(built.world);
    const before = engine.exportState().world;
    const result = engine.command(
      'aip.autoFillCard',
      { eventInstanceId: built.shows[show] },
      issuedBy,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code, message })],
    });
    expect(engine.exportState().world).toEqual(before);
  });

  it('rebuilds a full card when asked', () => {
    const built = fillWorld();
    const engine = engineFor(built.world);
    const result = applied(
      engine.command(
        'aip.autoFillCard',
        { eventInstanceId: built.shows.full, keepFilledSlots: false },
        PLAYER_ONE,
      ),
    );
    expect(result.filled.length).toBeGreaterThan(0);
  });

  it('returns the reason on a thin roster and leaves the show and its card alone', () => {
    const built = fillWorld(3);
    const engine = engineFor(built.world);
    const before = engine.exportState().world;
    const cases = [
      { show: built.shows.open, keepFilledSlots: true, kept: 0 },
      { show: built.shows.full, keepFilledSlots: false, kept: SLOTS + 1 },
    ];
    for (const { show, keepFilledSlots, kept } of cases) {
      const result = applied(
        engine.command('aip.autoFillCard', { eventInstanceId: show, keepFilledSlots }, PLAYER_ONE),
      );
      expect(result).toEqual({
        filled: [],
        open: [],
        kept,
        message: 'Only 3 wrestlers available, needs 5',
      });
    }
    const after = engine.exportState().world;
    expect(after.tables).toEqual(before.tables);
    for (const show of [built.shows.open, built.shows.full]) {
      expect(after.tables.eventInstances.find((row) => row.id === show)?.status).toBe('scheduled');
    }
  });

  it('draws from aip.autofill, so rival cards that day are the same with or without a press', async () => {
    const rivalCard = async (press: boolean) => {
      const built = fillWorld();
      const engine = engineFor(built.world);
      if (press) {
        applied(
          engine.command('aip.autoFillCard', { eventInstanceId: built.shows.open }, PLAYER_ONE),
        );
        expect(Object.keys(engine.exportState().rng.streams)).toContain('aip.autofill');
      }
      const advanced = await engine.advanceDays({ maxDays: 1 });
      expect(advanced.failures).toEqual([]);
      const tables = engine.exportState().world.tables;
      const segments = tables.segments
        .filter((segment) => segment.eventInstanceId === built.shows.rival)
        .sort(
          (left, right) => Number(left.preShow) - Number(right.preShow) || left.slot - right.slot,
        );
      expect(segments.length).toBeGreaterThan(0);
      return segments.map((segment) => ({
        slot: segment.slot,
        preShow: segment.preShow,
        kind: segment.kind,
        type: segment.kind === 'match' ? segment.match.matchTypeKey : segment.angle.angleTypeKey,
        people: tables.participants
          .filter((row) => row.segmentId === segment.id)
          .map((row) => row.personId)
          .sort(),
      }));
    };
    expect(await rivalCard(true)).toEqual(await rivalCard(false));
  });

  it('refuses a save with no match types', () => {
    const built = fillWorld(14, false);
    const engine = engineFor(built.world);
    expect(
      engine.command('aip.autoFillCard', { eventInstanceId: built.shows.open }, PLAYER_ONE),
    ).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'noCatalog', message: NO_CATALOG_MESSAGE })],
    });
  });

  it('records the issuer in the command log', () => {
    const built = fillWorld();
    const engine = engineFor(built.world);
    engine.command('aip.autoFillCard', { eventInstanceId: built.shows.open }, PLAYER_TWO);
    engine.command('aip.autoFillCard', { eventInstanceId: built.shows.open }, PLAYER_ONE);
    const log = engine.query('sim.commandLog', { limit: 10 }, OMNISCIENT);
    if (!log.ok) {
      throw new Error('sim.commandLog failed');
    }
    expect(log.data).toMatchObject([
      {
        name: 'aip.autoFillCard',
        issuedBy: PLAYER_TWO,
        outcome: 'rejected',
        reasonCodes: ['notYourShow'],
      },
      { name: 'aip.autoFillCard', issuedBy: PLAYER_ONE, outcome: 'applied', reasonCodes: [] },
    ]);
  });
});
