// Lock and Unlock card. Design: docs/design/booking.md#lock-and-unlock
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import type { Employment } from '../../../src/model/entities/employment';
import { defaultSystems } from '../../../src/systems';
import { MAX_LOCK_REASONS } from '../../../src/systems/booking';
import { testId } from '../../support';
import {
  angle,
  book,
  bookRunnable,
  change,
  match,
  PLAYER_ONE,
  PLAYER_TWO,
  validate,
  validateWorld,
  who,
  type ValidateWorld,
} from './validate-world';

const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
const OMNISCIENT: Viewer = { kind: 'omniscient' };

function engineOver(built: ValidateWorld): Engine {
  return createEngine({ state: initialEngineState(built.world), systems: defaultSystems });
}

function statusOf(engine: Engine, id: EventInstanceId): string | undefined {
  return engine.exportState().world.tables.eventInstances.find((show) => show.id === id)?.status;
}

function lockEvents(engine: Engine): { type: string; payload: unknown }[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['card.locked', 'card.unlocked'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.map((event) => ({ type: event.type, payload: event.payload }));
}

function gateSubjects(engine: Engine): (string | undefined)[] {
  const result = engine.query('sim.pendingGates', {}, AS_PLAYER_ONE);
  if (!result.ok) {
    throw new Error(`sim.pendingGates was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.hits.map((hit) => hit.subject?.id);
}

describe('booking.lockCard', () => {
  it('refuses a card with errors, with one cardNotRunnable reason per error', () => {
    const built = validateWorld();
    const opener = book(built, 0, match([[who(built, 6)], [who(built, 7)]], { outcome: null }));
    const engine = engineOver(built);
    const before = engine.exportState();
    const result = engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'cardNotRunnable',
          message: 'Main card: 1 of 6 slots filled (needs 3)',
          subject: { kind: 'eventInstance', id: built.show },
        },
        {
          code: 'cardNotRunnable',
          message: 'Opener: no result planned; pick a winner, a draw or a no contest',
          subject: { kind: 'segment', id: opener },
        },
        {
          code: 'cardNotRunnable',
          message: 'The main event (Slot 6) is empty',
          subject: { kind: 'eventInstance', id: built.show },
        },
      ],
    });
    expect(engine.exportState().world).toEqual(before.world);
    expect(lockEvents(engine)).toEqual([]);
  });

  it('refuses with exactly the errors booking.validate reports', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 1, match([[who(built, 3)], [who(built, 0)]], { titleIds: [built.tag] }));
    const engine = engineOver(built);
    const answer = engine.query('booking.validate', { eventInstanceId: built.show }, AS_PLAYER_ONE);
    const result = engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(answer.ok && answer.data.runnable).toBe(false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.map((reason) => reason.message)).toEqual(
      answer.ok ? answer.data.errors.map((issue) => issue.message) : [],
    );
  });

  it(`lists at most ${String(MAX_LOCK_REASONS)} reasons`, () => {
    const built = validateWorld();
    // Max Dorn, injured, in six matches without a result: more errors than a refusal lists.
    for (const slot of [0, 1, 2, 3, 4, 5]) {
      book(built, slot, match([[who(built, 4)], [who(built, 5 + slot)]], { outcome: null }));
    }
    const engine = engineOver(built);
    const result = engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    const errors = validate(built).errors;
    expect(errors.length).toBeGreaterThan(MAX_LOCK_REASONS);
    expect(!result.ok && result.reasons).toHaveLength(MAX_LOCK_REASONS);
  });

  it('locks a card with warnings only and publishes card.locked once', () => {
    const built = validateWorld();
    bookRunnable(built);
    change(built, (tx) => {
      const [employment] = tx.view.tables.employments.lookup('byPerson', who(built, 6));
      if (employment === undefined) {
        throw new Error('Mia Torres has no contract');
      }
      tx.update('employments', employment.id, {
        brandId: built.brandTwo,
      } satisfies Partial<Employment>);
    });
    expect(validate(built).warnings.map((issue) => issue.code)).toEqual(['otherBrand']);
    const engine = engineOver(built);
    const result = engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(result.ok && result.data).toEqual({ status: 'booked' });
    expect(result.ok && result.events.map((event) => event.type)).toEqual(['card.locked']);
    expect(statusOf(engine, built.show)).toBe('booked');
    expect(lockEvents(engine)).toEqual([
      {
        type: 'card.locked',
        payload: {
          eventInstanceId: built.show,
          promotionId: built.world.tables.eventInstances.get(built.show)?.promotionId,
          brandId: built.brandOne,
        },
      },
    ]);
  });

  it('clears the show-day gate so Next Day moves the date', async () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    expect(gateSubjects(engine)).toEqual([built.show]);
    expect(engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE).ok).toBe(
      true,
    );
    expect(gateSubjects(engine)).toEqual([]);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    expect(advanced.daysAdvanced).toBe(1);
    const clock = engine.query('clock.get', {}, AS_PLAYER_ONE);
    expect(clock.ok && clock.data.date).toBe(parseGameDate('2026-01-06'));
  });

  it('refuses a card that is already locked', () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE)).toEqual(
      {
        ok: false,
        reasons: [
          {
            code: 'cardLocked',
            message: 'This card is already locked',
            subject: { kind: 'eventInstance', id: built.show },
          },
        ],
      },
    );
    expect(lockEvents(engine)).toHaveLength(1);
  });

  it("refuses a rival's show, a past show and an unknown show", () => {
    const built = validateWorld();
    bookRunnable(built, built.past);
    const engine = engineOver(built);
    expect(
      engine.command('booking.lockCard', { eventInstanceId: built.rival }, PLAYER_ONE),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
    expect(
      engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_TWO),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
    expect(
      engine.command('booking.lockCard', { eventInstanceId: built.past }, PLAYER_ONE),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: 'showPast', message: 'This show has already happened' }],
    });
    expect(
      engine.command(
        'booking.lockCard',
        { eventInstanceId: testId('eventInstance', 9999) },
        PLAYER_ONE,
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'showNotFound' }] });
  });
});

describe('booking.unlockCard', () => {
  it('puts the gate back and publishes card.unlocked once', () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    const result = engine.command(
      'booking.unlockCard',
      { eventInstanceId: built.show },
      PLAYER_ONE,
    );
    expect(result.ok && result.data).toEqual({ status: 'scheduled' });
    expect(result.ok && result.events.map((event) => event.type)).toEqual(['card.unlocked']);
    expect(statusOf(engine, built.show)).toBe('scheduled');
    expect(gateSubjects(engine)).toEqual([built.show]);
    expect(lockEvents(engine).map((event) => event.type)).toEqual(['card.locked', 'card.unlocked']);
  });

  it('lets the card change again once unlocked', () => {
    const built = validateWorld();
    bookRunnable(built);
    const engine = engineOver(built);
    engine.command('booking.lockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    const draft = angle([who(built, 11)]);
    const add = () =>
      engine.command(
        'booking.addSegment',
        { eventInstanceId: built.show, preShow: false, slot: 1, draft },
        PLAYER_ONE,
      );
    expect(add()).toMatchObject({ ok: false, reasons: [{ code: 'cardLocked' }] });
    engine.command('booking.unlockCard', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(add().ok).toBe(true);
  });

  it('refuses a card that is not locked, a rival show and a past show', () => {
    const built = validateWorld();
    const engine = engineOver(built);
    expect(
      engine.command('booking.unlockCard', { eventInstanceId: built.show }, PLAYER_ONE),
    ).toEqual({
      ok: false,
      reasons: [
        {
          code: 'cardNotLocked',
          message: "This card isn't locked",
          subject: { kind: 'eventInstance', id: built.show },
        },
      ],
    });
    change(built, (tx) => {
      tx.update('eventInstances', built.past, { status: 'booked' });
      tx.update('eventInstances', built.rival, { status: 'booked' });
    });
    const later = engineOver(built);
    expect(
      later.command('booking.unlockCard', { eventInstanceId: built.rival }, PLAYER_ONE),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notYourShow' }] });
    expect(
      later.command('booking.unlockCard', { eventInstanceId: built.past }, PLAYER_ONE),
    ).toMatchObject({ ok: false, reasons: [{ code: 'showPast' }] });
    expect(lockEvents(later)).toEqual([]);
  });
});
