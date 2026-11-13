// The booking commands. Design: docs/design/booking.md#commands
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type CommandName,
  type Engine,
} from '../../../src/core/api';
import { defineCommand } from '../../../src/core/api/command';
import { defineSystem } from '../../../src/core/api/system';
import { parseContentKey } from '../../../src/core/content-key';
import type { EventInstanceId, SegmentId } from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import type { MatchOutcome, Segment } from '../../../src/model/entities/segment';
import type { GameTables, GameWorld } from '../../../src/model/tables';
import type { Tx } from '../../../src/model/tx';
import { defaultSystems } from '../../../src/systems';
import {
  addSegmentCommand,
  bookingCommands,
  BOOKING_COMMAND_REASON_CODES,
  draftFromSegment,
} from '../../../src/systems/booking';
import { testId } from '../../support';
import { expectSerialisable } from '../../support/trace';
import {
  COMPUTER,
  OMNISCIENT,
  PLAYER_ONE,
  PLAYER_THREE,
  PLAYER_TWO,
} from '../calendar/lifecycle-world';
import {
  cardChanges,
  commandWorld,
  PINFALL,
  promo,
  seed,
  singles,
  SUBMISSION,
  wrestler,
  type CommandWorld,
} from './command-world';

type PlannedResult = MatchOutcome | null;

function engineFor(world: GameWorld, systems = defaultSystems): Engine {
  return createEngine({ state: initialEngineState(world), systems });
}

/** A command world with a match (roster 0 v 1) in slot 0 and a promo (roster 2) in slot 1 of `show`. */
function bookedOn(show: keyof CommandWorld['shows'] = 'open') {
  const booked = commandWorld();
  const eventInstanceId = booked.shows[show];
  // The computer promotion's show is booked from its own roster.
  const [left, right, speaker] =
    show === 'computer'
      ? [...booked.rivals, ...booked.rivals]
      : [wrestler(booked, 0), wrestler(booked, 1), wrestler(booked, 2)];
  if (left === undefined || right === undefined || speaker === undefined) {
    throw new Error('The command world is missing a wrestler');
  }
  const match = seed(booked.world, eventInstanceId, 0, singles(left, right));
  const angle = seed(booked.world, eventInstanceId, 1, promo(speaker));
  return { ...booked, eventInstanceId, match, angle, engine: engineFor(booked.world) };
}

function segmentsOf(engine: Engine): Segment[] {
  return engine.exportState().world.tables.segments;
}

function segmentIn(engine: Engine, id: SegmentId): Segment {
  const segment = segmentsOf(engine).find((row) => row.id === id);
  if (segment === undefined) {
    throw new Error(`No segment ${id}`);
  }
  return segment;
}

/** The data of an applied command, or a test failure with its reasons. */
function applied<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`The command was refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

/** Runs `issue` and expects it refused with exactly one reason of `code`, changing nothing. */
function expectRefused(
  engine: Engine,
  issue: () => { ok: boolean; reasons?: unknown },
  code: string,
  message?: string,
): void {
  const before = engine.exportState();
  const result = issue();
  expect(result).toEqual({
    ok: false,
    reasons: [expect.objectContaining(message === undefined ? { code } : { code, message })],
  });
  const after = engine.exportState();
  expect(after.world).toEqual(before.world);
  expect(after.events).toEqual(before.events);
}

/** Every one of the six commands against the show and its match, in an order that all apply. */
function everyEdit(
  engine: Engine,
  eventInstanceId: EventInstanceId,
  match: SegmentId,
  draft: ReturnType<typeof singles>,
  issuedBy: Controller,
): (() => { ok: boolean; reasons?: unknown })[] {
  return [
    () =>
      engine.command(
        'booking.addSegment',
        { eventInstanceId, preShow: false, slot: 3, draft },
        issuedBy,
      ),
    () => engine.command('booking.updateSegment', { segmentId: match, draft }, issuedBy),
    () =>
      engine.command(
        'booking.moveSegment',
        { segmentId: match, toPreShow: false, toSlot: 2 },
        issuedBy,
      ),
    () =>
      engine.command('booking.setResult', { segmentId: match, result: { kind: 'draw' } }, issuedBy),
    () => engine.command('booking.removeSegment', { segmentId: match }, issuedBy),
    () => engine.command('booking.clearCard', { eventInstanceId }, issuedBy),
  ];
}

describe('booking.addSegment', () => {
  it('puts a segment in an open slot and publishes card.changed', () => {
    const booked = commandWorld();
    const engine = engineFor(booked.world);
    const eventInstanceId = booked.shows.open;
    const draft = singles(wrestler(booked, 0), wrestler(booked, 1), {
      kind: 'win',
      winningSide: 0,
      methodKey: PINFALL,
    });
    const result = engine.command(
      'booking.addSegment',
      { eventInstanceId, preShow: false, slot: 2, draft },
      PLAYER_ONE,
    );
    const { segmentId } = applied(result);
    expect(result).toMatchObject({ events: [{ type: 'card.changed' }] });
    expect(segmentIn(engine, segmentId)).toMatchObject({
      eventInstanceId,
      preShow: false,
      slot: 2,
      kind: 'match',
      outcome: { kind: 'win', winningSide: 0, methodKey: PINFALL },
      rating: null,
    });
    const changes = cardChanges(engine);
    expect(changes).toEqual([
      {
        eventInstanceId,
        promotionId: booked.world.tables.eventInstances.require(eventInstanceId).promotionId,
        brandId: null,
        segmentId,
        change: 'added',
      },
    ]);
    changes.forEach(expectSerialisable);
  });

  it('adds to the pre-show and adds angles', () => {
    const booked = commandWorld();
    const engine = engineFor(booked.world);
    const { segmentId } = applied(
      engine.command(
        'booking.addSegment',
        {
          eventInstanceId: booked.shows.open,
          preShow: true,
          slot: 0,
          draft: promo(wrestler(booked, 3)),
        },
        PLAYER_ONE,
      ),
    );
    expect(segmentIn(engine, segmentId)).toMatchObject({ preShow: true, slot: 0, kind: 'angle' });
  });

  it('refuses a taken slot, a slot off the format, an outsider and a one-sided match', () => {
    const { engine, eventInstanceId, ...booked } = bookedOn();
    const add = (slot: number, draft: ReturnType<typeof singles>) => () =>
      engine.command(
        'booking.addSegment',
        { eventInstanceId, preShow: false, slot, draft },
        PLAYER_ONE,
      );
    const fair = singles(wrestler(booked, 4), wrestler(booked, 5));
    expectRefused(engine, add(0, fair), 'slotTaken', 'Slot 1 already has a segment');
    expectRefused(engine, add(4, fair), 'slotOutsideFormat', "Slot 5 doesn't exist on this show");
    const outsider = booked.rivals[0];
    if (outsider === undefined) {
      throw new Error('No rival wrestler');
    }
    expectRefused(engine, add(2, singles(wrestler(booked, 4), outsider)), 'notOnRoster');
    const oneSided = {
      ...fair,
      participants: fair.participants.map((participant) => ({ ...participant, side: 0 })),
    };
    expectRefused(engine, add(2, oneSided), 'tooFewSides');
  });

  it('refuses bad arguments before anything else', () => {
    const booked = commandWorld();
    const engine = engineFor(booked.world);
    const result = engine.commandRaw(
      'booking.addSegment',
      {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: -1,
        draft: promo(wrestler(booked, 0)),
      },
      PLAYER_ONE,
    );
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'invalidArgs', field: 'slot' }] });
  });
});

describe('booking.updateSegment', () => {
  it('replaces the draft in place, keeping the id and the slot', () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn();
    const draft = singles(wrestler(booked, 0), wrestler(booked, 5), {
      kind: 'win',
      winningSide: 1,
      methodKey: SUBMISSION,
    });
    const result = engine.command('booking.updateSegment', { segmentId: match, draft }, PLAYER_ONE);
    expect(applied(result)).toEqual({ segmentId: match });
    expect(segmentIn(engine, match)).toMatchObject({
      slot: 0,
      outcome: { kind: 'win', winningSide: 1, methodKey: SUBMISSION },
    });
    const people = engine
      .exportState()
      .world.tables.participants.filter((row) => row.segmentId === match)
      .map((row) => [row.personId, row.side]);
    expect(people).toEqual([
      [wrestler(booked, 0), 0],
      [wrestler(booked, 5), 1],
    ]);
    expect(cardChanges(engine)).toMatchObject([
      { eventInstanceId, segmentId: match, change: 'updated' },
    ]);
  });

  it('can turn a match into an angle', () => {
    const { engine, match, ...booked } = bookedOn();
    applied(
      engine.command(
        'booking.updateSegment',
        { segmentId: match, draft: promo(wrestler(booked, 6)) },
        PLAYER_ONE,
      ),
    );
    expect(segmentIn(engine, match).kind).toBe('angle');
  });

  it('publishes nothing when the draft is unchanged', () => {
    const { engine, match, world } = bookedOn();
    const draft = draftFromSegment(world, match);
    const result = engine.command('booking.updateSegment', { segmentId: match, draft }, PLAYER_ONE);
    expect(result).toEqual({ ok: true, data: { segmentId: match }, events: [] });
    expect(cardChanges(engine)).toEqual([]);
  });

  it('refuses a segment that does not exist and a broken draft', () => {
    const { engine, match, ...booked } = bookedOn();
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.updateSegment',
          { segmentId: testId('segment', 9999), draft: promo(wrestler(booked, 0)) },
          PLAYER_ONE,
        ),
      'segmentNotFound',
      'That segment is no longer on the card',
    );
    const unknownType = {
      ...promo(wrestler(booked, 0)),
      angle: { angleTypeKey: parseContentKey('angle.nothing') },
    };
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.updateSegment',
          { segmentId: match, draft: unknownType },
          PLAYER_ONE,
        ),
      'unknownAngleType',
    );
  });
});

describe('booking.removeSegment', () => {
  it('takes the segment and its participants off and leaves the slot open', () => {
    const { engine, match, angle } = bookedOn();
    expect(
      applied(engine.command('booking.removeSegment', { segmentId: match }, PLAYER_ONE)),
    ).toBeNull();
    const state = engine.exportState();
    expect(state.world.tables.segments.map((segment) => segment.id)).toEqual([angle]);
    expect(state.world.tables.participants.filter((row) => row.segmentId === match)).toEqual([]);
    expect(segmentIn(engine, angle).slot).toBe(1);
    expect(cardChanges(engine)).toMatchObject([{ segmentId: match, change: 'removed' }]);
  });

  it('refuses a segment that does not exist', () => {
    const { engine } = bookedOn();
    expectRefused(
      engine,
      () =>
        engine.command('booking.removeSegment', { segmentId: testId('segment', 9999) }, PLAYER_ONE),
      'segmentNotFound',
    );
  });
});

describe('booking.moveSegment', () => {
  it('moves into an open slot, swaps with a filled one and crosses into the pre-show', () => {
    const { engine, match, angle } = bookedOn();
    const move = (segmentId: SegmentId, toPreShow: boolean, toSlot: number) =>
      applied(engine.command('booking.moveSegment', { segmentId, toPreShow, toSlot }, PLAYER_ONE));
    expect(move(match, false, 3)).toEqual({ swappedWith: null });
    expect(segmentIn(engine, match).slot).toBe(3);
    expect(move(angle, false, 3)).toEqual({ swappedWith: match });
    expect(segmentIn(engine, angle).slot).toBe(3);
    expect(segmentIn(engine, match).slot).toBe(1);
    expect(move(match, true, 0)).toEqual({ swappedWith: null });
    expect(segmentIn(engine, match)).toMatchObject({ preShow: true, slot: 0 });
    expect(cardChanges(engine).map((change) => [change.segmentId, change.change])).toEqual([
      [match, 'moved'],
      [angle, 'moved'],
      [match, 'moved'],
    ]);
  });

  it('publishes nothing for a move onto its own slot', () => {
    const { engine, match } = bookedOn();
    const result = engine.command(
      'booking.moveSegment',
      { segmentId: match, toPreShow: false, toSlot: 0 },
      PLAYER_ONE,
    );
    expect(result).toEqual({ ok: true, data: { swappedWith: null }, events: [] });
  });

  it('refuses a slot that is not on the format', () => {
    const { engine, match } = bookedOn();
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.moveSegment',
          { segmentId: match, toPreShow: true, toSlot: 1 },
          PLAYER_ONE,
        ),
      'slotOutsideFormat',
      "Pre-show slot 2 doesn't exist on this show",
    );
  });
});

describe('booking.setResult', () => {
  it('plans a win, a draw and a no contest, and clears the plan', () => {
    const { engine, match } = bookedOn();
    const setResult = (result: PlannedResult) =>
      applied(engine.command('booking.setResult', { segmentId: match, result }, PLAYER_ONE));
    expect(setResult({ kind: 'win', winningSide: 1, methodKey: PINFALL })).toBeNull();
    expect(segmentIn(engine, match)).toMatchObject({
      outcome: { kind: 'win', winningSide: 1, methodKey: PINFALL },
    });
    setResult({ kind: 'draw' });
    expect(segmentIn(engine, match)).toMatchObject({ outcome: { kind: 'draw' } });
    setResult({ kind: 'noContest' });
    expect(segmentIn(engine, match)).toMatchObject({ outcome: { kind: 'noContest' } });
    setResult(null);
    expect(segmentIn(engine, match)).toMatchObject({ outcome: null });
    expect(cardChanges(engine).map((change) => change.change)).toEqual([
      'result',
      'result',
      'result',
      'result',
    ]);
  });

  it('publishes nothing when the result is the same', () => {
    const { engine, match } = bookedOn();
    const result = engine.command(
      'booking.setResult',
      { segmentId: match, result: null },
      PLAYER_ONE,
    );
    expect(result).toEqual({ ok: true, data: null, events: [] });
  });

  it('refuses an angle, a side with nobody wrestling and an unknown method', () => {
    const { engine, match, angle } = bookedOn();
    const setResult = (segmentId: SegmentId, result: PlannedResult) => () =>
      engine.command('booking.setResult', { segmentId, result }, PLAYER_ONE);
    expectRefused(
      engine,
      setResult(angle, { kind: 'draw' }),
      'notAMatch',
      'Only a match has a result to plan',
    );
    expectRefused(
      engine,
      setResult(match, { kind: 'win', winningSide: 2, methodKey: PINFALL }),
      'winnerWithoutCompetitor',
      "Side 3 has nobody wrestling, so it can't win",
    );
    expectRefused(
      engine,
      setResult(match, {
        kind: 'win',
        winningSide: 0,
        methodKey: parseContentKey('method.nothing'),
      }),
      'unknownMethod',
    );
  });
});

describe('booking.clearCard', () => {
  it('removes every segment and publishes one card.changed with no segment', () => {
    const { engine, eventInstanceId } = bookedOn();
    expect(applied(engine.command('booking.clearCard', { eventInstanceId }, PLAYER_ONE))).toEqual({
      removed: 2,
    });
    const state = engine.exportState();
    expect(state.world.tables.segments).toEqual([]);
    expect(state.world.tables.participants).toEqual([]);
    expect(cardChanges(engine)).toMatchObject([
      { eventInstanceId, segmentId: null, change: 'cleared' },
    ]);
  });

  it('clears an empty card without publishing anything', () => {
    const booked = commandWorld();
    const engine = engineFor(booked.world);
    const result = engine.command(
      'booking.clearCard',
      { eventInstanceId: booked.shows.open },
      PLAYER_ONE,
    );
    expect(result).toEqual({ ok: true, data: { removed: 0 }, events: [] });
  });

  it('refuses a show that does not exist', () => {
    const { engine } = bookedOn();
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.clearCard',
          { eventInstanceId: testId('eventInstance', 9999) },
          PLAYER_ONE,
        ),
      'showNotFound',
      'That show no longer exists',
    );
  });
});

describe('who may book a show', () => {
  it("refuses a human editing the computer promotion's show, and lets the computer", () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn('computer');
    const draft = singles(wrestler(booked, 0), wrestler(booked, 1));
    for (const edit of everyEdit(engine, eventInstanceId, match, draft, PLAYER_ONE)) {
      expectRefused(
        engine,
        edit,
        'notYourShow',
        'Only the person running Test Promotion B can book this show',
      );
    }
    applied(engine.command('booking.clearCard', { eventInstanceId }, COMPUTER));
  });

  it("lets a brand's own controller book its shows and refuses the promotion's", () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn('rival');
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.addSegment',
          { eventInstanceId, preShow: false, slot: 3, draft },
          PLAYER_ONE,
        ),
      'notYourShow',
      'Only the person running Test Brand Two can book this show',
    );
    applied(
      engine.command(
        'booking.addSegment',
        { eventInstanceId, preShow: false, slot: 3, draft },
        PLAYER_TWO,
      ),
    );
    applied(engine.command('booking.removeSegment', { segmentId: match }, PLAYER_TWO));
    expect(cardChanges(engine).map((change) => change.brandId)).toEqual([
      booked.world.tables.eventInstances.require(eventInstanceId).brandId,
      booked.world.tables.eventInstances.require(eventInstanceId).brandId,
    ]);
  });

  it("falls back to the promotion's controller for a brand without one", () => {
    const { engine, eventInstanceId, ...booked } = bookedOn('shared');
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    const add = (issuedBy: Controller) =>
      engine.command(
        'booking.addSegment',
        { eventInstanceId, preShow: false, slot: 3, draft },
        issuedBy,
      );
    expectRefused(
      engine,
      () => add(PLAYER_TWO),
      'notYourShow',
      'Only the person running Test Promotion A can book this show',
    );
    expectRefused(engine, () => add(PLAYER_THREE), 'notYourShow');
    applied(add(PLAYER_ONE));
  });

  it('checks who is asking before whether the card can change', () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn('locked');
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    for (const edit of everyEdit(engine, eventInstanceId, match, draft, PLAYER_TWO)) {
      expectRefused(engine, edit, 'notYourShow');
    }
  });

  it('declares every refusal code it adds', () => {
    expect([...BOOKING_COMMAND_REASON_CODES].sort()).toEqual([
      'notYourShow',
      'randomWinners',
      'segmentNotFound',
      'showNotFound',
    ]);
  });
});

describe('when a card can change', () => {
  it.each([
    ['cancelled', 'showCancelled', 'This show was cancelled'],
    ['yesterday', 'showPast', 'This show has already happened'],
  ] as const)('refuses every edit to the %s show with %s', (show, code, message) => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn(show);
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    for (const edit of everyEdit(engine, eventInstanceId, match, draft, PLAYER_ONE)) {
      expectRefused(engine, edit, code, message);
    }
  });

  it('refuses edits to a show that has run', () => {
    const booked = commandWorld();
    const engine = engineFor(booked.world);
    const eventInstanceId = booked.shows.completed;
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    expectRefused(
      engine,
      () =>
        engine.command(
          'booking.addSegment',
          { eventInstanceId, preShow: false, slot: 0, draft },
          PLAYER_ONE,
        ),
      'showCompleted',
      'This show has already run',
    );
    expectRefused(
      engine,
      () => engine.command('booking.clearCard', { eventInstanceId }, PLAYER_ONE),
      'showCompleted',
    );
  });

  it('lets every edit through on a show an old save left locked (there is no lock, EVT2-09)', () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn('locked');
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    for (const edit of everyEdit(engine, eventInstanceId, match, draft, PLAYER_ONE)) {
      expect(edit()).toMatchObject({ ok: true });
    }
  });

  it("lets every edit through on today's show", () => {
    const { engine, eventInstanceId, match, ...booked } = bookedOn('today');
    const draft = singles(wrestler(booked, 4), wrestler(booked, 5));
    for (const edit of everyEdit(engine, eventInstanceId, match, draft, PLAYER_ONE)) {
      expect(edit()).toMatchObject({ ok: true });
    }
  });
});

describe('the command log and atomicity', () => {
  it('records the issuer of applied and refused booking commands', () => {
    const { engine, eventInstanceId } = bookedOn();
    engine.command('booking.clearCard', { eventInstanceId }, PLAYER_THREE);
    engine.command('booking.clearCard', { eventInstanceId }, PLAYER_ONE);
    const log = engine.query('sim.commandLog', { limit: 10 }, OMNISCIENT);
    if (!log.ok) {
      throw new Error('sim.commandLog failed');
    }
    expect(log.data).toMatchObject([
      {
        name: 'booking.clearCard',
        issuedBy: PLAYER_THREE,
        outcome: 'rejected',
        reasonCodes: ['notYourShow'],
      },
      { name: 'booking.clearCard', issuedBy: PLAYER_ONE, outcome: 'applied', reasonCodes: [] },
    ]);
  });

  it('leaves no segment, participant or event behind when the writer throws half-way', () => {
    const booked = commandWorld();
    // The real addSegment, except that every participant is created twice: the second breaks the
    // unique (segment, person) index after the segment and its first participant are written.
    const breaking = defineCommand('booking.addSegment', {
      args: addSegmentCommand.args,
      validate: (read, args, issuedBy) => addSegmentCommand.validate(read, args, issuedBy),
      apply: (ctx, args, issuedBy) =>
        addSegmentCommand.apply({ ...ctx, tx: duplicatingParticipants(ctx.tx) }, args, issuedBy),
    });
    const systems = defaultSystems.map((system) =>
      system.id === 'booking'
        ? defineSystem({
            id: 'booking',
            queries: [],
            commands: [
              breaking,
              ...bookingCommands.filter((command) => command.name !== breaking.name),
            ],
            gates: [],
          })
        : system,
    );
    const engine = engineFor(booked.world, systems);
    const before = engine.exportState();
    const result = engine.command(
      'booking.addSegment',
      {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: 0,
        draft: singles(wrestler(booked, 0), wrestler(booked, 1)),
      },
      PLAYER_ONE,
    );
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'internal' }] });
    const after = engine.exportState();
    expect(after.world.tables.segments).toEqual([]);
    expect(after.world.tables.participants).toEqual([]);
    expect(after.world).toEqual(before.world);
    expect(after.events).toEqual(before.events);
    expect(cardChanges(engine)).toEqual([]);
  });
});

describe('determinism', () => {
  it('gives two engines fed the same commands the same world, ids included', () => {
    const run = () => {
      const booked = commandWorld();
      const engine = engineFor(booked.world);
      const eventInstanceId = booked.shows.open;
      const add = (slot: number, left: number, right: number) =>
        applied(
          engine.command(
            'booking.addSegment',
            {
              eventInstanceId,
              preShow: false,
              slot,
              draft: singles(wrestler(booked, left), wrestler(booked, right)),
            },
            PLAYER_ONE,
          ),
        ).segmentId;
      const first = add(0, 0, 1);
      const second = add(2, 2, 3);
      applied(
        engine.command(
          'booking.moveSegment',
          { segmentId: first, toPreShow: false, toSlot: 2 },
          PLAYER_ONE,
        ),
      );
      applied(
        engine.command(
          'booking.updateSegment',
          { segmentId: second, draft: singles(wrestler(booked, 2), wrestler(booked, 6)) },
          PLAYER_ONE,
        ),
      );
      applied(
        engine.command(
          'booking.setResult',
          { segmentId: first, result: { kind: 'draw' } },
          PLAYER_ONE,
        ),
      );
      applied(engine.command('booking.removeSegment', { segmentId: second }, PLAYER_ONE));
      add(1, 4, 5);
      return engine.exportState();
    };
    const left = run();
    const right = run();
    expect(left.world.tables.segments.length).toBe(2);
    expect(left.world).toEqual(right.world);
    expect(left.events).toEqual(right.events);
  });
});

/** Every command name this ticket adds, so a missing one fails to compile. */
const BOOKING_COMMAND_NAMES: readonly CommandName[] = bookingCommands.map(
  (command) => command.name,
);
it('registers the six card commands and no Lock / Unlock (EVT2-09)', () => {
  expect([...BOOKING_COMMAND_NAMES].sort()).toEqual([
    'booking.addSegment',
    'booking.clearCard',
    'booking.moveSegment',
    'booking.removeSegment',
    'booking.setResult',
    'booking.updateSegment',
  ]);
});

/** `tx`, except that every participant it creates (inside savepoints too) is created twice. */
function duplicatingParticipants(tx: Tx<GameTables>): Tx<GameTables> {
  const wrap = (inner: Tx<GameTables>): Tx<GameTables> => ({
    get label() {
      return inner.label;
    },
    get view() {
      return inner.view;
    },
    insert: (table, row) => inner.insert(table, row),
    mintId: (table) => inner.mintId(table),
    create: (table, fields) => {
      const row = inner.create(table, fields);
      if (table === 'participants') {
        inner.create(table, fields);
      }
      return row;
    },
    update: (table, id, change) => inner.update(table, id, change),
    delete: (table, id) => {
      inner.delete(table, id);
    },
    setMeta: (patch) => {
      inner.setMeta(patch);
    },
    savepoint: (label, body) => inner.savepoint(label, (nested) => body(wrap(nested))),
  });
  return wrap(tx);
}
