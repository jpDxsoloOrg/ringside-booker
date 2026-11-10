// The calendar.cancelShow command. Design: docs/design/calendar.md#cancelling-a-show
import { describe, expect, it } from 'vitest';
import type { Engine } from '../../../src/core/api';
import type { EventInstanceId } from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import { definitionAirDateKey } from '../../../src/model/entities/event-instance';
import { CANCEL_SHOW_REASON_CODES } from '../../../src/systems/calendar';
import { aMatch, testId } from '../../support';
import {
  advance,
  cancelledEvents,
  COMPUTER,
  engineOver,
  gameDate,
  lifecycleWorld,
  lifecycleWorldWith,
  LIFECYCLE_START,
  OMNISCIENT,
  PLAYER_ONE,
  PLAYER_THREE,
  PLAYER_TWO,
  showIn,
} from './lifecycle-world';

const TODAY = gameDate(LIFECYCLE_START);
const NEXT_WEEK = gameDate('2026-01-12');
const NOT_YOUR_SHOW = 'Only the promotion (or brand) that runs this show can cancel it.';

/** Issues the command and expects it refused with one reason, the world untouched, no event. */
function expectRefused(
  engine: Engine,
  eventInstanceId: EventInstanceId,
  issuedBy: Controller,
  code: string,
  message: string,
): void {
  const before = engine.exportState();
  const result = engine.command('calendar.cancelShow', { eventInstanceId }, issuedBy);
  expect(result).toEqual({
    ok: false,
    reasons: [expect.objectContaining({ code, message })],
  });
  expect('events' in result).toBe(false);
  const after = engine.exportState();
  expect(after.world).toEqual(before.world);
  expect(after.events).toEqual(before.events);
  expect(cancelledEvents(engine)).toEqual([]);
}

describe('calendar.cancelShow refusals', () => {
  it('refuses a show that does not exist', () => {
    const engine = engineOver(lifecycleWorld());
    expectRefused(
      engine,
      testId('eventInstance', 42),
      PLAYER_ONE,
      'notFound',
      'That show no longer exists.',
    );
  });

  it('refuses an id that is not a show id as invalid arguments', () => {
    const engine = engineOver(lifecycleWorld());
    const result = engine.commandRaw(
      'calendar.cancelShow',
      { eventInstanceId: 'not-a-show' },
      PLAYER_ONE,
    );
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'invalidArgs' }] });
  });

  it("refuses a human cancelling a computer promotion's show", () => {
    const built = lifecycleWorldWith((addShow, { promotionB }) =>
      addShow({ date: NEXT_WEEK, promotionId: promotionB }),
    );
    expectRefused(engineOver(built), built.shows, PLAYER_ONE, 'notYourShow', NOT_YOUR_SHOW);
  });

  it("refuses the computer and an outside player cancelling a human's show", () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: NEXT_WEEK }));
    const engine = engineOver(built);
    expectRefused(engine, built.shows, COMPUTER, 'notYourShow', NOT_YOUR_SHOW);
    expectRefused(engine, built.shows, PLAYER_THREE, 'notYourShow', NOT_YOUR_SHOW);
  });

  it('refuses a show whose day has passed', () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: TODAY }), {
      currentDate: '2026-01-08',
    });
    expectRefused(
      engineOver(built),
      built.shows,
      PLAYER_ONE,
      'showInPast',
      "This show's day has passed.",
    );
  });

  it('refuses a show that is already cancelled or already completed', () => {
    const built = lifecycleWorldWith((addShow) => ({
      cancelled: addShow({ date: NEXT_WEEK, status: 'cancelled' }),
      completed: addShow({ date: TODAY, status: 'completed' }),
    }));
    const engine = engineOver(built);
    expectRefused(
      engine,
      built.shows.cancelled,
      PLAYER_ONE,
      'alreadyCancelled',
      'This show has already been cancelled.',
    );
    expectRefused(
      engine,
      built.shows.completed,
      PLAYER_ONE,
      'alreadyCompleted',
      'This show has already taken place.',
    );
  });

  it('reports who may cancel before anything about the show itself', () => {
    const built = lifecycleWorldWith((addShow, { promotionB }) =>
      addShow({ date: NEXT_WEEK, promotionId: promotionB, status: 'cancelled' }),
    );
    expectRefused(engineOver(built), built.shows, PLAYER_ONE, 'notYourShow', NOT_YOUR_SHOW);
  });

  it('covers every refusal code the command declares', () => {
    expect([...CANCEL_SHOW_REASON_CODES].sort()).toEqual([
      'alreadyCancelled',
      'alreadyCompleted',
      'notFound',
      'notYourShow',
      'showInPast',
    ]);
  });
});

describe('calendar.cancelShow', () => {
  it('cancels a future show, keeps the row and publishes one show.cancelled', () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: NEXT_WEEK }));
    const engine = engineOver(built);
    const eventInstanceId = built.shows;
    const result = engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_ONE);
    expect(result).toMatchObject({ ok: true, data: null, events: [{ type: 'show.cancelled' }] });
    expect(showIn(engine.exportState(), eventInstanceId)).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: TODAY },
      date: NEXT_WEEK,
      result: null,
    });
    expect(cancelledEvents(engine)).toEqual([
      { eventInstanceId, promotionId: built.promotionA, date: NEXT_WEEK, reason: 'byPromotion' },
    ]);
  });

  it("cancels today's show before the day runs, and the day's close leaves it alone", async () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: TODAY, status: 'booked' }));
    const engine = engineOver(built);
    const eventInstanceId = built.shows;
    expect(engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_ONE).ok).toBe(true);
    const state = await advance(engine, 1);
    expect(showIn(state, eventInstanceId).cancellation).toEqual({
      reason: 'byPromotion',
      on: TODAY,
    });
    expect(cancelledEvents(engine)).toHaveLength(1);
  });

  it('does not touch the segments of the cancelled show', () => {
    const built = lifecycleWorldWith((addShow, _handles, context) => {
      const show = addShow({ date: NEXT_WEEK, status: 'booked' });
      context.insert('segments', aMatch({ eventInstanceId: show }, context.sequence));
      return show;
    });
    const engine = engineOver(built);
    const before = engine.exportState().world.tables.segments;
    expect(before).toHaveLength(1);
    const result = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: built.shows },
      PLAYER_ONE,
    );
    expect(result.ok).toBe(true);
    expect(engine.exportState().world.tables.segments).toEqual(before);
  });

  it('records the issuing controller in the command log, applied or refused', () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: NEXT_WEEK }));
    const engine = engineOver(built);
    const eventInstanceId = built.shows;
    engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_THREE);
    engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_ONE);
    const log = engine.query('sim.commandLog', { limit: 10 }, OMNISCIENT);
    if (!log.ok) {
      throw new Error('sim.commandLog failed');
    }
    expect(log.data).toMatchObject([
      {
        name: 'calendar.cancelShow',
        issuedBy: PLAYER_THREE,
        args: { eventInstanceId },
        outcome: 'rejected',
        reasonCodes: ['notYourShow'],
        date: TODAY,
      },
      {
        name: 'calendar.cancelShow',
        issuedBy: PLAYER_ONE,
        args: { eventInstanceId },
        outcome: 'applied',
        reasonCodes: [],
        date: TODAY,
      },
    ]);
  });

  it('lets the computer cancel a computer promotion show', () => {
    const built = lifecycleWorldWith((addShow, { promotionB }) =>
      addShow({ date: NEXT_WEEK, promotionId: promotionB }),
    );
    const engine = engineOver(built);
    const eventInstanceId = built.shows;
    expect(engine.command('calendar.cancelShow', { eventInstanceId }, COMPUTER).ok).toBe(true);
    expect(cancelledEvents(engine)).toEqual([
      { eventInstanceId, promotionId: built.promotionB, date: NEXT_WEEK, reason: 'byPromotion' },
    ]);
  });

  it("lets the brand's human cancel a brand show and refuses the promotion's human", () => {
    const built = lifecycleWorldWith((addShow, { rivalBrand }) =>
      addShow({ date: NEXT_WEEK, brandId: rivalBrand }),
    );
    const engine = engineOver(built);
    const eventInstanceId = built.shows;
    expectRefused(engine, eventInstanceId, PLAYER_ONE, 'notYourShow', NOT_YOUR_SHOW);
    expect(engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_TWO).ok).toBe(true);
    expect(showIn(engine.exportState(), eventInstanceId).status).toBe('cancelled');
  });

  it('is refused while the game is moving forward', async () => {
    const built = lifecycleWorldWith((addShow) => addShow({ date: NEXT_WEEK }));
    const engine = engineOver(built);
    const running = engine.advanceDays({ maxDays: 1 });
    const result = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: built.shows },
      PLAYER_ONE,
    );
    await running;
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'busy' }] });
    expect(showIn(engine.exportState(), built.shows).status).toBe('scheduled');
  });

  it('never brings a cancelled show back: no twin after the horizon runs', async () => {
    const built = lifecycleWorldWith(
      (addShow, _handles, context) => {
        const [definitionId] = context.ids.eventDefinitions;
        if (definitionId === undefined) {
          throw new Error('The world has no weekly show');
        }
        return {
          definitionId,
          show: addShow({ date: NEXT_WEEK, eventDefinitionId: definitionId }),
        };
      },
      { weeklyShow: true },
    );
    const { definitionId, show: eventInstanceId } = built.shows;
    const engine = engineOver(built);
    expect(engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_ONE).ok).toBe(true);

    const state = await advance(engine, 2);
    const onThatDate = state.world.tables.eventInstances.filter(
      (row) =>
        row.eventDefinitionId !== null &&
        definitionAirDateKey(row.eventDefinitionId, row.airDate) ===
          definitionAirDateKey(definitionId, NEXT_WEEK),
    );
    expect(onThatDate.map((row) => row.id)).toEqual([eventInstanceId]);
    expect(onThatDate[0]).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: TODAY },
    });
    // The horizon did run: the week after is on the books as an ordinary scheduled show.
    const weekAfter = state.world.tables.eventInstances.filter(
      (row) => row.eventDefinitionId === definitionId && row.date === '2026-01-19',
    );
    expect(weekAfter).toHaveLength(1);
    expect(weekAfter[0]?.status).toBe('scheduled');
    // Only the command's own event: nothing closed the show a second time.
    expect(cancelledEvents(engine)).toHaveLength(1);
  });
});
