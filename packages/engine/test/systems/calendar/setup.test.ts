// The opening schedule of a new game. Design: docs/design/calendar.md#horizon
import { describe, expect, it } from 'vitest';
import { addDays, compareDates, parseGameDate } from '../../../src/core/date';
import type { EngineState } from '../../../src/core/api';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import { CALENDAR_SETUP_STEP } from '../../../src/systems/calendar';
import { setupSteps } from '../../../src/systems/newgame';
import { expectedShowKeys, startDefaultGame, storedShowKeys } from './default-game';

const START = parseGameDate('2027-01-04');
const HORIZON_DAYS = 90;
const HORIZON_END = parseGameDate('2027-04-04');

function showsNamed(state: EngineState, name: string): EventInstance[] {
  return state.world.tables.eventInstances
    .filter((instance) => instance.name === name)
    .sort((left, right) => compareDates(left.date, right.date));
}

function datesIn(shows: readonly EventInstance[], prefix: string): string[] {
  return shows.map((show) => show.date).filter((date) => date.startsWith(prefix));
}

function horizonEvents(state: EngineState): unknown[] {
  return state.events.recent
    .filter((event) => event.type === 'calendar.horizonExtended')
    .map((event) => event.payload);
}

describe('calendar.scheduleOpening', () => {
  it('runs at order 810, straight after the world settings are stored', () => {
    const steps = setupSteps();
    const index = steps.findIndex((step) => step.id === CALENDAR_SETUP_STEP.id);
    expect(steps[index]).toEqual({ id: 'calendar.scheduleOpening', order: 810 });
    expect(steps[index - 1]).toEqual({ id: 'wld.storeSettings', order: 800 });
  });

  it("gives the flagship promotion's player their real opening dates", () => {
    const state = startDefaultGame();
    expect(state.world.meta.startDate).toBe(START);
    expect(addDays(START, HORIZON_DAYS)).toBe(HORIZON_END);

    expect(datesIn(showsNamed(state, 'Altura Mainstage'), '2027-01')).toEqual([
      '2027-01-04',
      '2027-01-11',
      '2027-01-18',
      '2027-01-25',
    ]);
    expect(datesIn(showsNamed(state, 'Altura Overclock'), '2027-01')).toEqual([
      '2027-01-06',
      '2027-01-13',
      '2027-01-20',
      '2027-01-27',
    ]);

    const [showcase] = showsNamed(state, 'Altura Showcase');
    expect(showcase).toMatchObject({
      date: '2027-01-31',
      importance: 'major',
      format: { slots: 8, preShowSlots: 1 },
      status: 'scheduled',
    });
    expect(showsNamed(state, 'Cold Front').map((show) => show.date)).toEqual(['2027-02-14']);
  });

  it('stores every show from the start date through start + 90 days and none beyond', () => {
    const state = startDefaultGame();
    const instances = state.world.tables.eventInstances;
    expect(instances.length).toBeGreaterThan(100);
    for (const instance of instances) {
      expect(compareDates(instance.date, START)).toBeGreaterThanOrEqual(0);
      expect(compareDates(instance.date, HORIZON_END)).toBeLessThanOrEqual(0);
      expect(instance.airDate).toBe(instance.date);
      expect(instance.status).toBe('scheduled');
      expect(instance.cancellation).toBeNull();
    }
    expect(storedShowKeys(state)).toEqual(expectedShowKeys(state, START, HORIZON_DAYS));
  });

  it('gives every active promotion shows, each in a real region', () => {
    const state = startDefaultGame();
    const regionIds = new Set<string>(state.world.tables.regions.map((region) => region.id));
    const withShows = new Set<string>();
    for (const instance of state.world.tables.eventInstances) {
      expect(regionIds.has(instance.regionId)).toBe(true);
      withShows.add(instance.promotionId);
    }
    const active = state.world.tables.promotions.filter((row) => row.status === 'active');
    expect(active).toHaveLength(12);
    expect([...withShows].sort()).toEqual(active.map((row) => row.id).sort());
  });

  it('publishes one summary event and no event per show', () => {
    const state = startDefaultGame();
    expect(horizonEvents(state)).toEqual([
      { from: START, through: HORIZON_END, created: state.world.tables.eventInstances.length },
    ]);
    expect(state.events.recent.some((event) => event.type === 'show.scheduled')).toBe(false);
  });

  it('reads the horizon from the overrides chosen for the new game', () => {
    const short = startDefaultGame({ tunableOverrides: { 'calendar.scheduleHorizonDays': 7 } });
    const through = parseGameDate('2027-01-11');
    expect(horizonEvents(short)).toMatchObject([{ from: START, through }]);
    expect(storedShowKeys(short)).toEqual(expectedShowKeys(short, START, 7));
    expect(short.world.tables.eventInstances.every((show) => show.date <= through)).toBe(true);

    const today = startDefaultGame({ tunableOverrides: { 'calendar.scheduleHorizonDays': 0 } });
    expect(today.world.tables.eventInstances.length).toBeGreaterThan(0);
    expect(today.world.tables.eventInstances.every((show) => show.date === START)).toBe(true);
  });

  it("includes a founded promotion's weekly show", () => {
    const state = startDefaultGame({
      player: {
        mode: 'found',
        name: 'Harbourside Grappling',
        shortName: 'HSG',
        homeRegionKey: 'us-northeast',
        style: 'technical',
        size: 'large',
        color: '#204060',
        starterKit: true,
        weeklyShowDay: 5,
      },
    });
    const weekly = showsNamed(state, 'HSG Weekly');
    expect(weekly.map((show) => show.date).slice(0, 2)).toEqual(['2027-01-09', '2027-01-16']);
    expect(weekly).toHaveLength(13);
    const founded = state.world.tables.promotions.find((row) => row.shortName === 'HSG');
    expect(weekly.every((show) => show.regionId === founded?.homeRegionId)).toBe(true);
  });

  it('builds the same schedule, with the same ids, from the same seed', () => {
    expect(startDefaultGame().world.tables.eventInstances).toEqual(
      startDefaultGame().world.tables.eventInstances,
    );
  });
});
