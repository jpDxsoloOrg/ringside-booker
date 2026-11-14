// Daily heat cooling (CRTV3-02). Design: docs/design/storylines.md#heat-decay
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays } from '../../../src/core/date';
import type { StorylineId } from '../../../src/core/ids';
import { findTraceNodes } from '../../../src/core/trace/helpers';
import { isFullTrace, type StoredTraceEntry } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Storyline } from '../../../src/model/entities/storyline';
import type { DeepPartial } from '../../../src/model/world';
import { storylineHeatTraceRef, storylinesSystem } from '../../../src/systems/storylines';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder } from '../../support';
import { ok, PLAYER_VIEWER } from './storyline-world';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const OMNISCIENT = { kind: 'omniscient' } as const;

/** The stored heat trace of a storyline, or null when none is stored. */
function storedHeat(engine: Engine, id: StorylineId): StoredTraceEntry | null {
  const result = engine.query('trace.get', { ref: storylineHeatTraceRef(id) }, OMNISCIENT);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data;
}

interface Fixture {
  engine: Engine;
  storylineId: StorylineId;
  rivalId: StorylineId;
}

/** The player's storyline (and a rival's), both started on the start date. */
function fixture(fields: DeepPartial<Storyline> = {}, overrides: TunableOverrides = {}): Fixture {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(2).withStoryline(
        { name: 'Test Feud', heat: 40, ...fields },
        {
          members: [
            [0, 'face'],
            [1, 'heel'],
          ],
        },
      ),
    )
    .withPromotion({}, (promotion) =>
      promotion
        .withRoster(1)
        .withStoryline({ name: 'Test Rival Feud', heat: 40 }, { members: [[0, 'heel']] }),
    )
    .build();
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, storylinesSystem],
  });
  for (const [key, value] of Object.entries(overrides)) {
    const result = engine.command('tunables.setOverride', { key, value }, HUMAN);
    if (!result.ok) {
      throw new Error(`could not set ${key}: ${JSON.stringify(result.reasons)}`);
    }
  }
  return { engine, storylineId: built.ids.storylines[0]!, rivalId: built.ids.storylines[1]! };
}

function heatOf(engine: Engine, id: StorylineId): number {
  const row = engine.exportState().world.tables.storylines.find((entry) => entry.id === id);
  if (row === undefined) throw new Error(`no storyline ${id}`);
  return row.heat;
}

describe('storylines.heatCooling', () => {
  it('holds for 7 days, then cools 1 a day: 33 on the day 14 days after the start', async () => {
    const { engine, storylineId } = fixture();
    // The first day simulated is the start date (0 days since progress): 15 days reach day 14.
    await engine.advanceDays({ maxDays: 8 });
    expect(heatOf(engine, storylineId)).toBe(40);
    await engine.advanceDays({ maxDays: 7 });
    expect(heatOf(engine, storylineId)).toBe(33);
  });

  it('is at 34 after a 14-day skip from the start date (the last day simulated is day 13)', async () => {
    const { engine, storylineId } = fixture();
    const result = await engine.advanceDays({ maxDays: 14 });
    expect(result.failures).toEqual([]);
    expect(heatOf(engine, storylineId)).toBe(34);
  });

  it('stores a full Why? for the player that names the cooling tunables', async () => {
    const { engine, storylineId, rivalId } = fixture();
    await engine.advanceDays({ maxDays: 9 });
    const entry = storedHeat(engine, storylineId);
    if (entry === null || !isFullTrace(entry)) throw new Error('expected a full heat trace');
    expect(entry.date).toBe(addDays(TEST_START_DATE, 8));
    const keys = findTraceNodes(entry.trace, 'tunable').map((node) => node.key);
    expect(keys).toEqual(
      expect.arrayContaining(['storylines.heat.decayPerDay', 'storylines.heat.decayGraceDays']),
    );
    // The rival's cools the same way but keeps only a summary.
    expect(heatOf(engine, rivalId)).toBe(39);
    const rival = storedHeat(engine, rivalId);
    expect(rival !== null && !isFullTrace(rival)).toBe(true);
  });

  it('records nothing while the heat does not change', async () => {
    const { engine, storylineId } = fixture();
    await engine.advanceDays({ maxDays: 5 });
    expect(storedHeat(engine, storylineId)).toBeNull();
  });

  it('counts the grace period from lastProgressOn', async () => {
    const { engine, storylineId } = fixture({ lastProgressOn: addDays(TEST_START_DATE, 10) });
    await engine.advanceDays({ maxDays: 18 });
    // Days 11..17 simulated with 1..7 days since progress: still inside the grace period.
    expect(heatOf(engine, storylineId)).toBe(40);
    await engine.advanceDays({ maxDays: 1 });
    expect(heatOf(engine, storylineId)).toBe(39);
  });

  it('never changes an ended storyline', async () => {
    const { engine, storylineId } = fixture({ status: 'ended', endedOn: TEST_START_DATE });
    await engine.advanceDays({ maxDays: 30 });
    expect(heatOf(engine, storylineId)).toBe(40);
  });

  it('leaves a storyline below the floor where it is', async () => {
    const { engine, storylineId } = fixture({ heat: 8 });
    await engine.advanceDays({ maxDays: 30 });
    expect(heatOf(engine, storylineId)).toBe(8);
  });

  it('stops cooling with decayPerDay 0', async () => {
    const { engine, storylineId } = fixture({}, { 'storylines.heat.decayPerDay': 0 });
    await engine.advanceDays({ maxDays: 30 });
    expect(heatOf(engine, storylineId)).toBe(40);
  });
});

describe('storylines.detail cooling', () => {
  it('says when cooling starts, then that it is cooling', async () => {
    const { engine, storylineId, rivalId } = fixture();
    const fresh = ok(engine.query('storylines.detail', { storylineId }, PLAYER_VIEWER));
    expect(fresh.cooling).toEqual({
      graceDays: 7,
      daysSinceProgress: 0,
      perDay: 1,
      floor: 10,
      coolingNow: false,
      startsInDays: 8,
    });
    expect(fresh.startedBecauseTraceRef).toBeNull();
    await engine.advanceDays({ maxDays: 8 });
    const cooling = ok(engine.query('storylines.detail', { storylineId }, PLAYER_VIEWER));
    expect(cooling.cooling).toMatchObject({
      daysSinceProgress: 8,
      coolingNow: true,
      startsInDays: null,
    });
    const rival = ok(engine.query('storylines.detail', { storylineId: rivalId }, PLAYER_VIEWER));
    expect(rival.cooling).toBeNull();
  });

  it('is null for an ended storyline and quiet for one on the floor', () => {
    const ended = fixture({ status: 'ended', endedOn: TEST_START_DATE });
    expect(
      ok(ended.engine.query('storylines.detail', { storylineId: ended.storylineId }, PLAYER_VIEWER))
        .cooling,
    ).toBeNull();
    const floor = fixture({ heat: 10 });
    expect(
      ok(floor.engine.query('storylines.detail', { storylineId: floor.storylineId }, PLAYER_VIEWER))
        .cooling,
    ).toMatchObject({ coolingNow: false, startsInDays: null });
  });
});
