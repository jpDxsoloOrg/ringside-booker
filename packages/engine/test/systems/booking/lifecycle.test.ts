// How cards meet the show lifecycle. Design: docs/design/booking.md#lifecycle
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { EventInstanceId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { withMyShowsRun } from '../../support';
import { advance, PLAYER_ONE, showIn } from '../calendar/lifecycle-world';
import { commandWorld, promo, seed, singles, wrestler } from './command-world';

/** The default systems, with the player running their show on its day (as Run the show would). */
function engineFor(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun(defaultSystems),
  });
}

/** A command world whose `show` has a match and a promo on its card. There is no lock (EVT2-09). */
function bookedCard(show: 'today' | 'open') {
  const booked = commandWorld();
  const eventInstanceId = booked.shows[show];
  const match = seed(
    booked.world,
    eventInstanceId,
    0,
    singles(wrestler(booked, 0), wrestler(booked, 1)),
  );
  seed(booked.world, eventInstanceId, 1, promo(wrestler(booked, 2)));
  return { ...booked, eventInstanceId, match, engine: engineFor(booked.world) };
}

function cardOf(engine: Engine, eventInstanceId: EventInstanceId) {
  return engine
    .exportState()
    .world.tables.segments.filter((segment) => segment.eventInstanceId === eventInstanceId);
}

describe('a card on its day', () => {
  it('runs when the player runs the show, so the day close leaves it alone, and keeps its segments', async () => {
    const { engine, eventInstanceId } = bookedCard('today');
    const before = cardOf(engine, eventInstanceId);
    expect(before).toHaveLength(2);
    const state = await advance(engine, 1);
    expect(showIn(state, eventInstanceId)).toMatchObject({
      status: 'completed',
      cancellation: null,
    });
    const after = cardOf(engine, eventInstanceId);
    expect(after.map((segment) => segment.id)).toEqual(before.map((segment) => segment.id));
    expect(after.every((segment) => segment.rating !== null)).toBe(true);
  });
});

describe('a cancelled show with a card', () => {
  it('keeps its card as history and refuses every edit', () => {
    const { engine, eventInstanceId, match, ...booked } = bookedCard('open');
    const before = cardOf(engine, eventInstanceId);
    const cancelled = engine.command('calendar.cancelShow', { eventInstanceId }, PLAYER_ONE);
    expect(cancelled.ok).toBe(true);
    expect(cardOf(engine, eventInstanceId)).toEqual(before);
    expect(
      engine.command(
        'booking.updateSegment',
        { segmentId: match, draft: singles(wrestler(booked, 0), wrestler(booked, 3)) },
        PLAYER_ONE,
      ),
    ).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'showCancelled' })],
    });
    expect(engine.command('booking.clearCard', { eventInstanceId }, PLAYER_ONE)).toMatchObject({
      ok: false,
      reasons: [{ code: 'showCancelled' }],
    });
    expect(cardOf(engine, eventInstanceId)).toEqual(before);
  });
});
