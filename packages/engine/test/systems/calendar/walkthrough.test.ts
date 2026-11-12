// The calendar's hand-test script, run against a real new game on the shipped default world: the
// dates, names and counts the owner is told to expect. When the world pack changes a show, this
// is the test that says the script needs updating. Design: docs/design/calendar.md#screen
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  type Engine,
  type EngineState,
  type QueryArgs,
  type QueryData,
  type QueryName,
} from '../../../src/core/api';
import { parseGameDate, weekday, type GameDate } from '../../../src/core/date';
import {
  createSaveDocument,
  encodeSave,
  ENGINE_VERSION,
  engineLoadOptions,
  engineSaveSchemaFingerprint,
  engineSaveState,
  engineStateFromSave,
  loadSave,
  TABLES,
} from '../../../src';
import type { CalendarShow } from '../../../src/systems/calendar';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../support';
import { expectTraceContains } from '../../support/trace';
import { startDefaultGame } from './default-game';

const PLAYER = { kind: 'human', playerId: 'local-player' } as const;
const AS_PLAYER = { kind: 'controller', controller: PLAYER } as const;

const START = parseGameDate('2027-01-04');
/** The weeks a January 2027 month view draws: Monday 28 December to Sunday 31 January. */
const JANUARY = { from: parseGameDate('2026-12-28'), to: parseGameDate('2027-01-31') } as const;
const FEBRUARY = { from: parseGameDate('2027-02-01'), to: parseGameDate('2027-02-28') } as const;
/** April 2027 on screen: Monday 29 March to Sunday 2 May. */
const APRIL = { from: parseGameDate('2027-03-29'), to: parseGameDate('2027-05-02') } as const;

const MONDAY = 0;
const WEDNESDAY = 2;
const THURSDAY = 3;
const FRIDAY = 4;
const SATURDAY = 5;

/** Words a calendar row must never carry: a card is slots, never a running time. */
const RUNNING_TIME = /\bmin(ute)?s?\b|\bhours?\b|duration/i;

// The show-day gate would stop every day with the player's unbooked show; these tests are about
// the calendar, so they run without it. booking/gate.test.ts covers the gate.
function engineOver(state: EngineState): Engine {
  return createEngine({ state, systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
}

function ask<Name extends QueryName>(
  engine: Engine,
  name: Name,
  args: QueryArgs<Name>,
): QueryData<Name> {
  const result = engine.query(name, args, AS_PLAYER);
  if (!result.ok) {
    throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

async function advanceOneDay(engine: Engine): Promise<void> {
  const result = await engine.advanceDays({ maxDays: 1 });
  if (result.failures.length > 0 || result.daysAdvanced !== 1) {
    throw new Error(`The day did not run cleanly: ${JSON.stringify(result)}`);
  }
}

interface Window {
  readonly from: GameDate;
  readonly to: GameDate;
}

function stored(engine: Engine, window: Window, scope: 'mine' | 'world'): readonly CalendarShow[] {
  return ask(engine, 'calendar.range', { ...window, scope }).shows;
}

function projected(
  engine: Engine,
  window: Window,
  scope: 'mine' | 'world',
): readonly CalendarShow[] {
  return ask(engine, 'calendar.projected', { ...window, scope }).shows;
}

function datesOf(shows: readonly CalendarShow[], name: string): string[] {
  return shows.filter((show) => show.name === name).map((show) => show.date);
}

function showOn(shows: readonly CalendarShow[], name: string, date: string): CalendarShow {
  const found = shows.filter((show) => show.name === name && show.date === date);
  const [only] = found;
  if (only === undefined || found.length !== 1) {
    throw new Error(`Expected one ${name} on ${date}, found ${String(found.length)}`);
  }
  return only;
}

function weekdaysOf(shows: readonly CalendarShow[], name: string): number[] {
  return [...new Set(shows.filter((show) => show.name === name).map((show) => weekday(show.date)))];
}

/** Saves the running game the way the app does and starts an engine from the loaded bytes. */
async function saveAndReload(engine: Engine): Promise<Engine> {
  const state = engine.exportState();
  const doc = createSaveDocument(engineSaveState(state), {
    headerPromotionId: null,
    savedAt: '2026-11-10T00:00:00.000Z',
    label: 'Calendar walkthrough',
    engineVersion: ENGINE_VERSION,
    schemaFingerprint: engineSaveSchemaFingerprint(),
  });
  const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
  if (!report.ok) {
    throw new Error(`The save did not load: ${JSON.stringify(report.issues)}`);
  }
  return engineOver(engineStateFromSave(report.doc));
}

describe('the calendar on a new default-world game', () => {
  it('opens on Monday 4 January 2027 with the weekly shows and the month’s major show', () => {
    const engine = engineOver(startDefaultGame());
    expect(ask(engine, 'clock.get', {}).date).toBe(START);

    const january = stored(engine, JANUARY, 'mine');
    expect(datesOf(january, 'Altura Mainstage')).toEqual([
      '2027-01-04',
      '2027-01-11',
      '2027-01-18',
      '2027-01-25',
    ]);
    expect(weekdaysOf(january, 'Altura Mainstage')).toEqual([MONDAY]);
    expect(datesOf(january, 'Altura Overclock')).toEqual([
      '2027-01-06',
      '2027-01-13',
      '2027-01-20',
      '2027-01-27',
    ]);
    expect(weekdaysOf(january, 'Altura Overclock')).toEqual([WEDNESDAY]);
    expect(showOn(january, 'Altura Showcase', '2027-01-31').importance).toBe('major');
    expect(january.every((show) => show.isOwn)).toBe(true);

    const february = stored(engine, FEBRUARY, 'mine');
    expect(showOn(february, 'Cold Front', '2027-02-14').importance).toBe('major');
  });

  it('gives the show sheet its facts, and a reason for the venue', () => {
    const engine = engineOver(startDefaultGame());
    const january = stored(engine, JANUARY, 'mine');

    const row = showOn(january, 'Altura Mainstage', '2027-01-11');
    if (row.eventInstanceId === null) {
      throw new Error('A stored show has an id');
    }
    const mainstage = ask(engine, 'calendar.show', { eventInstanceId: row.eventInstanceId });
    if (mainstage?.placementTrace == null) {
      throw new Error('Expected the show and why it is held where it is');
    }
    expect(mainstage).toMatchObject({
      importance: 'regular',
      brand: { name: 'Altura Mainstage' },
      format: { slots: 6, preShowSlots: 0 },
      televised: true,
      status: 'scheduled',
      canCancel: true,
      definition: { recurrenceText: 'Every Monday' },
      region: { countryName: 'United States' },
    });
    expect(mainstage.venue).not.toBeNull();
    expect(mainstage.placementTrace).toMatchObject({ kind: 'decision', chosen: 'preferredVenue' });
    expectTraceContains(
      { value: mainstage.venue, trace: mainstage.placementTrace },
      { kind: 'branch', label: 'The show has a preferred venue' },
    );

    expect(showOn(january, 'Altura Showcase', '2027-01-31').format).toMatchObject({
      slots: 8,
      preShowSlots: 1,
    });
  });

  it('never states a running time, on any row or in the venue’s reasoning', () => {
    const engine = engineOver(startDefaultGame());
    const rows = [...stored(engine, JANUARY, 'world'), ...projected(engine, APRIL, 'world')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const { name, ...facts } = row;
      // A show may be called anything (one rival's weekly is "… Iron Hour"); its facts may not.
      expect(JSON.stringify(facts), name).not.toMatch(RUNNING_TIME);
    }
    const [first] = stored(engine, JANUARY, 'mine');
    if (first === undefined || first.eventInstanceId === null) {
      throw new Error('Expected a stored show');
    }
    const detail = ask(engine, 'calendar.show', { eventInstanceId: first.eventInstanceId });
    expect(JSON.stringify(detail?.placementTrace)).not.toMatch(RUNNING_TIME);
  });

  it('lists the rivals in Whole world, five shows deep on Saturday 16 January', () => {
    const engine = engineOver(startDefaultGame());
    const mine = stored(engine, JANUARY, 'mine');
    const world = stored(engine, JANUARY, 'world');

    expect(weekdaysOf(world, 'Ashlar Thursday')).toEqual([THURSDAY]);
    expect(weekdaysOf(world, 'Boreal Friday Night')).toEqual([FRIDAY]);
    expect(weekdaysOf(world, 'Tessen Iron Hour')).toEqual([SATURDAY]);
    expect(datesOf(mine, 'Ashlar Thursday')).toEqual([]);

    expect(world.filter((show) => show.date === '2027-01-16')).toHaveLength(5);

    const [rival] = world.filter((show) => show.name === 'Ashlar Thursday');
    expect(rival).toMatchObject({ isOwn: false, canCancel: false });
  });

  it('projects April past the stored schedule, and stores a day more after Next Day', async () => {
    const engine = engineOver(startDefaultGame());

    expect(showOn(stored(engine, APRIL, 'mine'), 'Altitude', '2027-04-04')).toMatchObject({
      importance: 'flagship',
      status: 'scheduled',
    });
    expect(datesOf(stored(engine, APRIL, 'mine'), 'Altura Mainstage')).toEqual(['2027-03-29']);
    expect(
      showOn(projected(engine, APRIL, 'mine'), 'Altura Mainstage', '2027-04-05'),
    ).toMatchObject({ status: 'projected', eventInstanceId: null, canCancel: false });

    await advanceOneDay(engine);

    expect(showOn(stored(engine, APRIL, 'mine'), 'Altura Mainstage', '2027-04-05').status).toBe(
      'scheduled',
    );
    expect(datesOf(projected(engine, APRIL, 'mine'), 'Altura Mainstage')).not.toContain(
      '2027-04-05',
    );
  });

  it('keeps a cancelled show cancelled through a save, a reload and the next day', async () => {
    const engine = engineOver(startDefaultGame());
    const overclock = showOn(stored(engine, JANUARY, 'mine'), 'Altura Overclock', '2027-01-13');
    if (overclock.eventInstanceId === null) {
      throw new Error('A stored show has an id');
    }
    const cancelled = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: overclock.eventInstanceId },
      PLAYER,
    );
    expect(cancelled.ok).toBe(true);

    const reloaded = await saveAndReload(engine);
    const expected = {
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: START },
      canCancel: false,
    };
    expect(
      showOn(stored(reloaded, JANUARY, 'mine'), 'Altura Overclock', '2027-01-13'),
    ).toMatchObject(expected);

    // The schedule moving forward must not put a second Overclock on the cancelled date.
    await advanceOneDay(reloaded);
    expect(
      showOn(stored(reloaded, JANUARY, 'mine'), 'Altura Overclock', '2027-01-13'),
    ).toMatchObject(expected);
  });

  it('closes today’s unbooked show as not run when the day passes', async () => {
    const engine = engineOver(startDefaultGame());
    await advanceOneDay(engine);

    expect(ask(engine, 'clock.get', {}).date).toBe('2027-01-05');
    expect(showOn(stored(engine, JANUARY, 'mine'), 'Altura Mainstage', '2027-01-04')).toMatchObject(
      {
        status: 'cancelled',
        cancellation: { reason: 'notRun' },
        segmentCount: 0,
      },
    );
  });
});
