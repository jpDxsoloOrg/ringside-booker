// The show-day gate. Design: docs/design/booking.md#gate
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { showNeedsBookingGate } from '../../../src/systems/booking';
import { anEventInstance, rosterWorld, testId } from '../../support';
import {
  AS_PLAYER_ONE,
  bookingQueriesWorld,
  bookSix,
  engineOver,
  PLAYER_ONE,
  START,
} from './queries-world';

const TUESDAY = parseGameDate('2026-01-06');
const WEDNESDAY = parseGameDate('2026-01-07');

function pendingHits(engine: Engine) {
  const result = engine.query('sim.pendingGates', {}, AS_PLAYER_ONE);
  if (!result.ok) {
    throw new Error(`sim.pendingGates was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.hits;
}

function change(world: GameWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = world.transact('test change', body);
  if (!result.ok) {
    throw result.error;
  }
}

function lock(world: GameWorld, id: EventInstanceId): void {
  change(world, (tx) => {
    tx.update('eventInstances', id, { status: 'booked' });
  });
}

describe('booking.showNeedsBooking', () => {
  it("stops today on the player's show that has no card yet", () => {
    const built = bookingQueriesWorld();
    expect(pendingHits(engineOver(built.world))).toEqual([
      {
        gateId: 'booking.showNeedsBooking',
        reason: "Your show 'Test Monday Show' on 2026-01-05 has no card yet",
        subject: { kind: 'eventInstance', id: built.shows.six },
        actionHint: 'booking',
      },
    ]);
  });

  it('says the card is not locked once segments are on it', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.reason)).toEqual([
      "Your card for 'Test Monday Show' on 2026-01-05 isn't locked yet",
    ]);
  });

  it('clears once the card is locked', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    lock(built.world, built.shows.six);
    expect(pendingHits(engineOver(built.world))).toEqual([]);
  });

  it('never hits for a cancelled show, even one with a card', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    change(built.world, (tx) => {
      tx.update('eventInstances', built.shows.six, {
        status: 'cancelled',
        cancellation: { reason: 'byPromotion', on: START },
      });
    });
    expect(pendingHits(engineOver(built.world))).toEqual([]);
  });

  it('never hits for a computer-run show', () => {
    const built = bookingQueriesWorld();
    // Tuesday holds promotion B's show and the show of Brand Two, which the computer runs.
    expect(built.world.tables.eventInstances.lookup('byDate', TUESDAY)).toHaveLength(2);
    expect(showNeedsBookingGate.check(built.world, TUESDAY)).toBeNull();
  });

  it('hits for a brand a human runs inside a computer-run promotion', () => {
    const built = bookingQueriesWorld();
    const promotionId = built.world.tables.eventInstances.get(built.shows.six)?.promotionId;
    if (promotionId === undefined) {
      throw new Error('The Monday show is missing');
    }
    change(built.world, (tx) => {
      tx.update('promotions', promotionId, { controller: { kind: 'computer' } });
      tx.update('brands', built.brandOne, { controller: PLAYER_ONE });
    });
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.subject)).toEqual([
      { kind: 'eventInstance', id: built.shows.six },
    ]);
  });

  it('names the lowest id first, then the next once that one is locked', () => {
    const built = bookingQueriesWorld();
    const six = built.world.tables.eventInstances.get(built.shows.six);
    if (six === undefined) {
      throw new Error('The Monday show is missing');
    }
    const second = testId('eventInstance', 9000);
    change(built.world, (tx) => {
      tx.insert(
        'eventInstances',
        anEventInstance({
          id: second,
          promotionId: six.promotionId,
          brandId: six.brandId,
          regionId: six.regionId,
          name: 'Test Second Monday Show',
          date: START,
          airDate: START,
        }),
      );
    });
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.subject?.id)).toEqual([
      built.shows.six,
    ]);
    lock(built.world, built.shows.six);
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.subject?.id)).toEqual([second]);
  });

  it("stops a skip before simulating the player's show day", async () => {
    const built = bookingQueriesWorld();
    lock(built.world, built.shows.six);
    const engine = engineOver(built.world);
    const result = await engine.advanceDays({ maxDays: 7 });

    // Monday and Tuesday run; Wednesday's unbooked show stops the skip before it is simulated.
    expect(result.failures).toEqual([]);
    expect(result.daysAdvanced).toBe(2);
    expect(result.endDate).toBe(WEDNESDAY);
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [
        {
          gateId: 'booking.showNeedsBooking',
          reason: "Your show 'Test Wednesday Show' on 2026-01-07 has no card yet",
          subject: { kind: 'eventInstance', id: built.shows.three },
          actionHint: 'booking',
        },
      ],
    });
    const clock = engine.query('clock.get', {}, AS_PLAYER_ONE);
    expect(clock.ok && clock.data.date).toBe(WEDNESDAY);
    expect(clock.ok && clock.data.date).not.toBe(parseGameDate('2026-01-08'));
  });

  it('leaves a headless world without a human promotion running', async () => {
    const engine = createEngine({
      state: initialEngineState(rosterWorld(10).world),
      systems: defaultSystems,
    });
    const result = await engine.advanceDays({ maxDays: 30 });
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(result.daysAdvanced).toBe(30);
  });
});
