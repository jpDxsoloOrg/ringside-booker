// The daily horizon phase. Design: docs/design/calendar.md#horizon
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { addDays, compareDates, parseGameDate } from '../../../src/core/date';
import { defaultSystems } from '../../../src/systems';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE, worldBuilder } from '../../support';
import { expectedShowKeys, startDefaultGame, storedShowKeys } from './default-game';

const OMNISCIENT = { kind: 'omniscient' } as const;
const HORIZON_DAYS = 90;

// The show-day gate would stop every day with the player's unbooked show; these tests are about
// the calendar, so they run without it. booking/gate.test.ts covers the gate.
function engineOver(state: EngineState): Engine {
  return createEngine({ state, systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
}

async function advance(engine: Engine, days: number): Promise<EngineState> {
  const result = await engine.advanceDays({ maxDays: days });
  expect(result.failures).toEqual([]);
  expect(result.daysAdvanced).toBe(days);
  return engine.exportState();
}

function scheduledEvents(engine: Engine): { eventInstanceId: string; date: string }[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['show.scheduled'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.flatMap((event) => (event.type === 'show.scheduled' ? [event.payload] : []));
}

describe('calendar.extendHorizon', () => {
  it('is a daily housekeeping phase at order 20', () => {
    const phase = defaultSystems
      .flatMap((system) => system.phases)
      .find((candidate) => candidate.id === 'calendar.extendHorizon');
    expect(phase).toMatchObject({ group: 'housekeeping', order: 20, cadence: { kind: 'daily' } });
  });

  it('keeps today through today + 90 days stored, once each, over 30 days', async () => {
    const engine = engineOver(startDefaultGame());
    for (let dayNumber = 1; dayNumber <= 30; dayNumber += 1) {
      const state = await advance(engine, 1);
      const today = state.world.meta.currentDate;
      const horizonEnd = addDays(today, HORIZON_DAYS);
      expect(
        storedShowKeys(state, (instance) => compareDates(instance.airDate, today) >= 0),
        `day ${String(dayNumber)}`,
      ).toEqual(expectedShowKeys(state, today, HORIZON_DAYS));
      expect(
        state.world.tables.eventInstances.every(
          (instance) => compareDates(instance.date, horizonEnd) <= 0,
        ),
      ).toBe(true);
    }
  });

  it('publishes show.scheduled for each show the day adds, and only those', async () => {
    const before = startDefaultGame();
    const known = new Set<string>(before.world.tables.eventInstances.map((row) => row.id));
    const engine = engineOver(before);
    const after = await advance(engine, 7);
    const added = after.world.tables.eventInstances.filter((row) => !known.has(row.id));
    expect(added.length).toBeGreaterThan(0);
    expect(
      scheduledEvents(engine)
        .map((payload) => payload.eventInstanceId)
        .sort(),
    ).toEqual(added.map((row) => row.id).sort());
    for (const row of added) {
      // Start + 91 through start + 97: only dates the horizon newly reached.
      expect(compareDates(row.date, parseGameDate('2027-04-05'))).toBeGreaterThanOrEqual(0);
      expect(compareDates(row.date, parseGameDate('2027-04-11'))).toBeLessThanOrEqual(0);
    }
  });

  it('stores nothing after today once a day has run with a horizon of 0', async () => {
    const engine = engineOver(
      startDefaultGame({ tunableOverrides: { 'calendar.scheduleHorizonDays': 0 } }),
    );
    for (let dayNumber = 1; dayNumber <= 10; dayNumber += 1) {
      const state = await advance(engine, 1);
      const today = state.world.meta.currentDate;
      expect(
        state.world.tables.eventInstances.every(
          (instance) => compareDates(instance.date, today) <= 0,
        ),
        `day ${String(dayNumber)}`,
      ).toBe(true);
      expect(
        storedShowKeys(state, (instance) => instance.airDate === today),
        `day ${String(dayNumber)}`,
      ).toEqual(expectedShowKeys(state, today, 0));
    }
  });

  it('fills an older game that has no shows from the day after its first day', async () => {
    const { world } = worldBuilder({ startDate: '2026-01-05' })
      .withGeography('mini')
      .withPromotion({}, (promotion) =>
        promotion.withWeeklyShow({ name: 'Monday Show' }).withWeeklyShow({ weekdays: [1] }),
      )
      .build();
    const engine = engineOver(initialEngineState(world));
    const state = await advance(engine, 1);
    const dates = state.world.tables.eventInstances.map((instance) => instance.date).sort();
    // Nothing on the day that was simulated (Monday the 5th); tomorrow onward is filled.
    expect(dates[0]).toBe('2026-01-06');
    expect(dates).not.toContain('2026-01-05');
    expect(dates.at(-1)).toBe('2026-04-06');
    expect(storedShowKeys(state)).toEqual(
      expectedShowKeys(state, parseGameDate('2026-01-06'), HORIZON_DAYS),
    );
  });
});
