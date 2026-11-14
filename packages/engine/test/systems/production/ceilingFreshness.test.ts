// A production level change reaches EVT4's show-quality ceiling and bonus slot (ECO7-05).
// Design: docs/design/production.md#effects, docs/design/card-flow.md#bonus-slot
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { parseGameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { GameWorld } from '../../../src/model/tables';
import { calendarSystem, scheduleAll } from '../../../src/systems/calendar';
import { cardFlowSystem } from '../../../src/systems/cardFlow';
import { financeSystem } from '../../../src/systems/finance';
import { productionSystem } from '../../../src/systems/production';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID, worldBuilder } from '../../support';
import { seed, singles } from '../booking/command-world';
import { PLAYER } from './production-world';
import { ALTURA } from './support';

const START = '2026-01-05'; // a Monday

interface FreshWorld {
  readonly world: GameWorld;
  readonly promotionId: PromotionId;
}

/**
 * The player's promotion at Altura's levels (show-quality ceiling 86.5, the bonus slot needs 90)
 * with $10M and a six-slot regular show every Monday, scheduled four weeks ahead. The first
 * future show has a match booked; the rest are empty.
 */
function freshWorld(): FreshWorld {
  const built = worldBuilder({ startDate: START, currentDate: START })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Altura',
        production: ALTURA,
        cash: cents(1_000_000_000),
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion
          .withRoster(2)
          .withWeeklyShow(
            { name: 'Test Regular', weekdays: [1] },
            { importance: 'regular', format: { slots: 6, preShowSlots: 0 } },
          ),
    )
    .build();
  const { world, ids } = built;
  const scheduled = world.transact('schedule', (tx) =>
    scheduleAll(tx, tx.view, parseGameDate(START), parseGameDate('2026-02-01'), {
      tunables: createEngineTunables(),
      recordTrace: { record: () => undefined, date: parseGameDate(START) },
    }),
  );
  if (!scheduled.ok) throw scheduled.error;
  const [first] = futureShows(world);
  const [left, right] = ids.people;
  const promotionId = ids.promotions.A;
  if (first === undefined || left === undefined || right === undefined || !promotionId) {
    throw new Error('freshWorld: missing ids');
  }
  seed(world, first.id, 0, singles(left, right));
  return { world, promotionId };
}

function futureShows(world: Pick<GameWorld, 'tables'>) {
  return world.tables.eventInstances
    .values()
    .filter((show) => show.date > START)
    .sort((left, right) => (left.date < right.date ? -1 : 1));
}

function engineOf(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, calendarSystem, cardFlowSystem, financeSystem, productionSystem],
  });
}

function ceilingOf(engine: Engine, promotionId: PromotionId) {
  const answer = engine.query('production.ceiling', { promotionId }, { kind: 'omniscient' });
  if (!answer.ok) throw new Error('production.ceiling refused');
  return answer.data;
}

/** The slot count of each show that was in the future at the start, earliest first. */
function slotsOf(engine: Engine, ids: readonly string[]): number[] {
  const shows = engine.exportState().world.tables.eventInstances;
  return ids.map((id) => shows.find((show) => show.id === id)?.format.slots ?? -1);
}

describe('a production change and the show-quality ceiling', () => {
  it('moves the ceiling at once and the bonus slot on empty future shows the next day', async () => {
    const { world, promotionId } = freshWorld();
    const [booked, ...empty] = futureShows(world).map((show) => show.id);
    if (booked === undefined || empty.length === 0) throw new Error('expected future shows');
    const engine = engineOf(world);
    expect(ceilingOf(engine, promotionId)).toMatchObject({
      ceiling: 86.5,
      bonusSlot: { qualifies: false },
    });

    // Camera 8 → 10 adds 2 × 2: 90.5, past the 90 the bonus slot needs.
    const raised = engine.command(
      'production.setLevel',
      { promotionId, area: 'camera', level: 10 },
      PLAYER,
    );
    expect(raised.ok).toBe(true);
    expect(ceilingOf(engine, promotionId)).toMatchObject({
      ceiling: 90.5,
      bonusSlot: { qualifies: true },
    });
    // Nothing moves until the daily refresh.
    expect(slotsOf(engine, [booked, ...empty])).toEqual([6, ...empty.map(() => 6)]);

    await engine.advanceDays({ maxDays: 1 });
    // The empty shows gain the slot; the show whose card has started keeps its count.
    expect(slotsOf(engine, [booked, ...empty])).toEqual([6, ...empty.map(() => 7)]);

    const lowered = engine.command(
      'production.setLevel',
      { promotionId, area: 'camera', level: 8 },
      PLAYER,
    );
    expect(lowered.ok).toBe(true);
    expect(ceilingOf(engine, promotionId).ceiling).toBe(86.5);
    await engine.advanceDays({ maxDays: 1 });
    expect(slotsOf(engine, [booked, ...empty])).toEqual([6, ...empty.map(() => 6)]);
  });
});
