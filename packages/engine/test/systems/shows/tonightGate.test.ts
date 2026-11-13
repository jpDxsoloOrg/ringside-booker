// The show-day gate, `shows.tonight` (EVT2-09). Design: docs/design/show-night.md#the-players-shows
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { showsTonightGate } from '../../../src/systems/shows';
import { anEventInstance, rosterWorld, testId } from '../../support';
import {
  AS_PLAYER_ONE,
  bookingQueriesWorld,
  bookSix,
  engineOver,
  PLAYER_ONE,
  START,
} from '../booking/queries-world';

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

function setStatus(world: GameWorld, id: EventInstanceId, status: 'booked' | 'completed'): void {
  change(world, (tx) => {
    tx.update(
      'eventInstances',
      id,
      status === 'booked'
        ? { status }
        : {
            status,
            result: {
              score: 50,
              rawScore: 50,
              traceId: 'shows.showScore:test',
              attendance: null,
              gate: null,
              viewers: null,
            },
          },
    );
  });
}

describe('shows.tonight', () => {
  it("stops today on the player's show that has no card yet", () => {
    const built = bookingQueriesWorld();
    expect(pendingHits(engineOver(built.world))).toEqual([
      {
        gateId: 'shows.tonight',
        reason: "Your show 'Test Monday Show' has no card yet",
        subject: { kind: 'eventInstance', id: built.shows.six },
        actionHint: 'showNight',
      },
    ]);
  });

  it('says "Tonight" once segments are on the card', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.reason)).toEqual([
      'Tonight: Test Monday Show',
    ]);
  });

  it('still stops on a show an old save left locked (booked)', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    setStatus(built.world, built.shows.six, 'booked');
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.reason)).toEqual([
      'Tonight: Test Monday Show',
    ]);
  });

  it('clears once the show has run', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    setStatus(built.world, built.shows.six, 'completed');
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
    expect(showsTonightGate.check(built.world, TUESDAY)).toBeNull();
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

  it('names the first in running order, then the next once that one has run', () => {
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
    setStatus(built.world, built.shows.six, 'completed');
    expect(pendingHits(engineOver(built.world)).map((hit) => hit.subject?.id)).toEqual([second]);
  });

  it("stops a skip before simulating the player's show day", async () => {
    const built = bookingQueriesWorld();
    setStatus(built.world, built.shows.six, 'completed');
    const engine = engineOver(built.world);
    const result = await engine.advanceDays({ maxDays: 7 });

    // Monday (its show already run) and Tuesday run; Wednesday's show stops the skip before it is
    // simulated.
    expect(result.failures).toEqual([]);
    expect(result.daysAdvanced).toBe(2);
    expect(result.endDate).toBe(WEDNESDAY);
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [
        {
          gateId: 'shows.tonight',
          reason: "Your show 'Test Wednesday Show' has no card yet",
          subject: { kind: 'eventInstance', id: built.shows.three },
          actionHint: 'showNight',
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
