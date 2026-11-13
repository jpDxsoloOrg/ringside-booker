// The bonus slot on newly scheduled shows and its daily refresh (EVT4-02).
// Design: docs/design/card-flow.md#bonus-slot
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { TraceRef } from '../../../src/core/trace/store';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { GameWorld } from '../../../src/model/tables';
import { calendarSystem, scheduleAll } from '../../../src/systems/calendar';
import {
  BONUS_SLOT_TRACE_KIND,
  cardFlowSystem,
  refreshBonusSlotsPhase,
} from '../../../src/systems/cardFlow';
import { defaultSystems } from '../../../src/systems';
import { createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type BuiltWorld } from '../../support';
import { seed, singles } from '../booking/command-world';

const START = '2026-01-05'; // a Monday
const ALTURA = { stage: 8, camera: 8, editing: 7, pyro: 8 }; // a ceiling of 86.5
const OMNISCIENT = { kind: 'omniscient' } as const;

function day(text: string): GameDate {
  return parseGameDate(text);
}

/** One promotion at Altura's levels with a regular, a minor and a 12-slot regular weekly show. */
function productionWorld(): BuiltWorld {
  return worldBuilder({ startDate: START, currentDate: START })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Altura', production: { ...ALTURA } }, (promotion) =>
      promotion
        .withRoster(2)
        .withWeeklyShow(
          { name: 'Test Regular', weekdays: [1] },
          { importance: 'regular', format: { slots: 6, preShowSlots: 0 } },
        )
        .withWeeklyShow(
          { name: 'Test Minor', weekdays: [3] },
          { importance: 'minor', format: { slots: 5, preShowSlots: 0 } },
        )
        .withWeeklyShow(
          { name: 'Test Twelve', weekdays: [5] },
          { importance: 'major', format: { slots: 12, preShowSlots: 1 } },
        ),
    )
    .build();
}

function schedule(
  world: GameWorld,
  overrides: Record<string, number> = {},
  recorded: TraceRef[] = [],
): void {
  const result = world.transact('schedule', (tx) =>
    scheduleAll(tx, tx.view, day(START), day('2026-02-01'), {
      tunables: createEngineTunables(overrides),
      recordTrace: {
        record: (ref) => {
          recorded.push(ref);
        },
        date: day(START),
      },
    }),
  );
  if (!result.ok) throw result.error;
}

function slotsByName(shows: readonly EventInstance[]): Record<string, number[]> {
  const byName: Record<string, number[]> = {};
  for (const show of shows) {
    (byName[show.name] ??= []).push(show.format.slots);
  }
  return byName;
}

function uniqueSlots(shows: readonly EventInstance[]): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(slotsByName(shows)).map(([name, slots]) => [name, [...new Set(slots)]]),
  );
}

describe('the bonus slot on newly scheduled shows', () => {
  it('keeps every definition format at the default threshold (nobody starts at 90)', () => {
    const { world } = productionWorld();
    schedule(world);
    expect(uniqueSlots(world.tables.eventInstances.values())).toEqual({
      'Test Regular': [6],
      'Test Minor': [5],
      'Test Twelve': [12],
    });
  });

  it('gives regular shows 7 slots at a threshold of 80; minor and 12-slot shows keep theirs', () => {
    const { world } = productionWorld();
    const recorded: TraceRef[] = [];
    schedule(world, { 'production.bonusSlotThreshold': 80 }, recorded);
    const shows = world.tables.eventInstances.values();
    expect(uniqueSlots(shows)).toEqual({
      'Test Regular': [7],
      'Test Minor': [5],
      'Test Twelve': [12],
    });
    // The pre-show is never touched.
    expect(shows.find((show) => show.name === 'Test Twelve')?.format.preShowSlots).toBe(1);
    // A decision is recorded for each regular-or-bigger show, under the show's id.
    const considered = shows.filter((show) => show.name !== 'Test Minor').map((show) => show.id);
    expect(recorded.map((ref) => ref.kind)).toEqual(considered.map(() => BONUS_SLOT_TRACE_KIND));
    expect(recorded.map((ref) => ref.id).sort()).toEqual([...considered].sort());
  });
});

describe('cardFlow.refreshBonusSlots', () => {
  it('is a daily housekeeping phase at order 26, in the default systems', () => {
    expect(refreshBonusSlotsPhase).toMatchObject({
      id: 'cardFlow.refreshBonusSlots',
      group: 'housekeeping',
      order: 26,
      cadence: { kind: 'daily' },
    });
    expect(defaultSystems).toContain(cardFlowSystem);
  });

  async function runDay(state: EngineState, overrides: Record<string, number>) {
    const engine = createEngine({
      state: { ...state, tunableOverrides: overrides },
      systems: [simSystem, calendarSystem, cardFlowSystem],
    });
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    return engine;
  }

  it('adds and removes the slot only on empty future shows', async () => {
    const built = productionWorld();
    const { world, ids } = built;
    schedule(world);
    const regular = world.tables.eventInstances
      .values()
      .filter((show) => show.name === 'Test Regular')
      .sort((left, right) => (left.date < right.date ? -1 : 1));
    // Shows dated today are never touched; the first future show gets a segment.
    const future = regular.filter((show) => show.date > START);
    const [booked, ...empty] = future;
    if (booked === undefined || empty.length === 0) throw new Error('expected regular shows');
    const today = regular.filter((show) => show.date <= START);
    const [left, right] = ids.people;
    if (left === undefined || right === undefined) throw new Error('expected a roster');
    seed(world, booked.id, 0, singles(left, right));

    const upgraded = await runDay(initialEngineState(world), {
      'production.bonusSlotThreshold': 80,
    });
    const after = upgraded.exportState().world.tables.eventInstances;
    const slotsOf = (id: string) => after.find((row) => row.id === id)?.format.slots;
    expect(slotsOf(booked.id)).toBe(6);
    for (const show of today) {
      expect(slotsOf(show.id)).toBe(6);
    }
    for (const show of empty) {
      expect(slotsOf(show.id)).toBe(7);
    }
    expect(uniqueSlots(after.filter((show) => show.name !== 'Test Regular'))).toEqual({
      'Test Minor': [5],
      'Test Twelve': [12],
    });
    const firstEmpty = empty[0];
    if (firstEmpty === undefined) throw new Error('expected an empty show');
    const trace = upgraded.query(
      'trace.get',
      { ref: { kind: BONUS_SLOT_TRACE_KIND, id: firstEmpty.id } },
      OMNISCIENT,
    );
    expect(
      trace.ok && trace.data !== null && 'trace' in trace.data ? trace.data.trace.value : null,
    ).toBe('bonusSlot');

    const downgraded = await runDay(upgraded.exportState(), {});
    const back = downgraded.exportState().world.tables.eventInstances;
    for (const show of empty) {
      expect(back.find((row) => row.id === show.id)?.format.slots).toBe(6);
    }
    expect(back.find((row) => row.id === booked.id)?.format.slots).toBe(6);
  });
});
