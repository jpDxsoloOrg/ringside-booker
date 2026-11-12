// The calendar's queries. Design: docs/design/calendar.md#queries
import { describe, expect, it } from 'vitest';
import { addDays, compareDates } from '../../../src/core/date';
import type { CalendarShow } from '../../../src/systems/calendar';
import {
  CALENDAR_RANGE_MESSAGES,
  MAX_CALENDAR_RANGE_DAYS,
  placeShow,
  toCalendarShow,
} from '../../../src/systems/calendar';
import { aMatch, anAngle, anEventInstance, aVenue, testId } from '../../support';
import { expectSerialisable, expectTraceContains } from '../../support/trace';
import {
  advance,
  AS_COMPUTER,
  AS_PLAYER_ONE,
  AS_PLAYER_TWO,
  ask,
  calendarWorld,
  calendarWorldWith,
  engineOver,
  FRIDAY_SHOW_ENDS,
  gameDate,
  HORIZON_END,
  OMNISCIENT,
  PLAYER_ONE,
  START,
  storedShowId,
} from './queries-world';
import { lifecycleWorld } from './lifecycle-world';

const SECOND_MONDAY = gameDate('2026-01-12');
const FIRST_FRIDAY = gameDate('2026-01-09');
const LAST_SUNDAY_OF_JANUARY = gameDate('2026-01-25');
/** Six weeks: the widest month grid a screen draws. */
const SIX_WEEKS_END = gameDate('2026-02-15');
const SIX_WEEKS = { from: START, to: SIX_WEEKS_END } as const;
/** The longest window allowed, from the start date. */
const LONGEST = { from: START, to: addDays(START, MAX_CALENDAR_RANGE_DAYS) } as const;

/** Field names a calendar row must never have: money (rival finances) and lengths (D-10). */
const FORBIDDEN_FIELD = /result|gate|revenue|cash|attendance|viewers|minute|duration|length/i;

function fieldNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNamesOf);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([name, child]) => [name, ...fieldNamesOf(child)]);
}

function keysOf(shows: readonly CalendarShow[]): string[] {
  return shows.map((show) => show.key);
}

function showOn(shows: readonly CalendarShow[], definitionId: string, date: string): CalendarShow {
  const found = shows.find((show) => show.definitionId === definitionId && show.date === date);
  if (found === undefined) {
    throw new Error(`No show of ${definitionId} on ${date}`);
  }
  return found;
}

describe('calendar.range', () => {
  it("returns every promotion's shows for the world and only the player's own for mine", () => {
    const built = calendarWorld();
    const engine = engineOver(built);

    const world = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, AS_PLAYER_ONE);
    expect(world.today).toBe(START);
    expect(world.horizonEnd).toBe(HORIZON_END);
    // Six Mondays for A; for B, six Fridays and the last Sunday of January. C is dormant.
    expect(world.shows).toHaveLength(13);
    expect(world.shows.filter((show) => show.promotion.id === built.promotionA)).toHaveLength(6);
    expect(world.shows.filter((show) => show.promotion.id === built.promotionB)).toHaveLength(7);
    expect(world.shows.some((show) => show.promotion.id === built.promotionC)).toBe(false);
    expect(world.shows.map((show) => show.isOwn)).toEqual(
      world.shows.map((show) => show.promotion.id === built.promotionA),
    );
    expectSerialisable(world);

    const mine = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'mine' }, AS_PLAYER_ONE);
    expect(mine.shows).toEqual(world.shows.filter((show) => show.isOwn));
    expect(mine.shows).toHaveLength(6);
    expectSerialisable(mine);
  });

  it('builds each row from its stored show', () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const { shows } = ask(
      engine,
      'calendar.range',
      { ...SIX_WEEKS, scope: 'world' },
      AS_PLAYER_ONE,
    );

    const special = showOn(shows, built.monthly, LAST_SUNDAY_OF_JANUARY);
    const storedSpecial = built.world.tables.eventInstances
      .lookup('byDate', LAST_SUNDAY_OF_JANUARY)
      .find((instance) => instance.eventDefinitionId === built.monthly);
    expect(storedSpecial?.id).toBe(special.eventInstanceId);
    expect(special).toEqual({
      key: special.eventInstanceId,
      eventInstanceId: storedSpecial?.id,
      definitionId: built.monthly,
      promotion: {
        id: built.promotionB,
        name: 'Test Promotion B',
        shortName: built.world.tables.promotions.get(built.promotionB)?.shortName,
        color: built.world.tables.promotions.get(built.promotionB)?.color,
      },
      isOwn: false,
      brand: null,
      name: 'Test Monthly Special',
      importance: 'major',
      format: { slots: 8, preShowSlots: 1 },
      televised: false,
      date: LAST_SUNDAY_OF_JANUARY,
      airDate: LAST_SUNDAY_OF_JANUARY,
      status: 'scheduled',
      cancellation: null,
      region: {
        id: built.rivalRegion,
        name: 'Test Region South 1',
        countryName: 'Test Country South',
      },
      venue: { id: built.rivalVenue, name: 'Test Rival Arena', capacity: 12_000, kind: 'arena' },
      segmentCount: 0,
      canCancel: false,
      score: null,
    });

    const weekly = showOn(shows, built.weekly, SECOND_MONDAY);
    expect(weekly).toMatchObject({
      promotion: { id: built.promotionA, name: 'Test Promotion A' },
      isOwn: true,
      brand: { id: built.brandA, name: 'Test Brand One' },
      name: 'Test Weekly',
      importance: 'regular',
      televised: true,
      status: 'scheduled',
      region: {
        id: built.homeRegion,
        name: 'Test Region North 1',
        countryName: 'Test Country North',
      },
      venue: null,
      canCancel: true,
    });
  });

  it('gives the same row as toCalendarShow', () => {
    const built = calendarWorld();
    const { shows } = ask(
      engineOver(built),
      'calendar.range',
      { ...SIX_WEEKS, scope: 'world' },
      AS_PLAYER_ONE,
    );
    for (const show of shows) {
      const stored = built.world.tables.eventInstances
        .values()
        .find((instance) => instance.id === show.eventInstanceId);
      if (stored === undefined) {
        throw new Error(`No stored show for ${show.key}`);
      }
      expect(toCalendarShow(built.world, stored, AS_PLAYER_ONE, START)).toEqual(show);
    }
  });

  it('carries no money and no lengths, for any viewer', () => {
    const built = calendarWorldWith((context, { promotionB }) =>
      context.insert(
        'eventInstances',
        anEventInstance(
          { promotionId: promotionB, date: START, status: 'completed' },
          context.sequence,
        ),
      ),
    );
    const engine = engineOver(built);
    expect(built.kept.result).not.toBeNull();
    for (const viewer of [AS_PLAYER_ONE, AS_COMPUTER, OMNISCIENT]) {
      const view = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, viewer);
      expect(keysOf(view.shows)).toContain(built.kept.id);
      expect(fieldNamesOf(view).filter((name) => FORBIDDEN_FIELD.test(name))).toEqual([]);
    }
    const detail = ask(engine, 'calendar.show', { eventInstanceId: built.kept.id }, OMNISCIENT);
    expect(detail?.status).toBe('completed');
    // The trace is the placement rule's reasoning, not part of the row.
    const row = { ...detail, placementTrace: null };
    expect(fieldNamesOf(row).filter((name) => FORBIDDEN_FIELD.test(name))).toEqual([]);
  });

  it("gives a completed show's score, a rival's too, and null for every other show", () => {
    const built = calendarWorldWith((context, { promotionB }) =>
      context.insert(
        'eventInstances',
        anEventInstance(
          { promotionId: promotionB, date: START, status: 'completed' },
          context.sequence,
        ),
      ),
    );
    const engine = engineOver(built);
    const score = built.kept.result?.score;
    expect(score).toEqual(expect.any(Number));
    for (const viewer of [AS_PLAYER_ONE, AS_COMPUTER, OMNISCIENT]) {
      const { shows } = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, viewer);
      for (const show of shows) {
        expect(show.score).toBe(show.eventInstanceId === built.kept.id ? score : null);
      }
    }
    const projected = ask(
      engine,
      'calendar.projected',
      { ...LONGEST, scope: 'world' },
      AS_PLAYER_ONE,
    );
    expect(projected.shows.every((show) => show.score === null)).toBe(true);
  });

  it("reports a cancelled show's reason and the day it was called off", () => {
    const built = calendarWorldWith((context, { weekly }) =>
      storedShowId(context, weekly, SECOND_MONDAY),
    );
    const engine = engineOver(built);
    const cancelled = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: built.kept },
      PLAYER_ONE,
    );
    expect(cancelled.ok).toBe(true);

    const { shows } = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'mine' }, AS_PLAYER_ONE);
    expect(showOn(shows, built.weekly, SECOND_MONDAY)).toMatchObject({
      eventInstanceId: built.kept,
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: START },
      canCancel: false,
    });
  });

  it("counts the segments on a show's card", () => {
    const built = calendarWorldWith((context, { weekly }) => {
      const booked = storedShowId(context, weekly, SECOND_MONDAY);
      context.insert('segments', aMatch({ eventInstanceId: booked }, context.sequence));
      context.insert('segments', aMatch({ eventInstanceId: booked }, context.sequence));
      context.insert('segments', anAngle({ eventInstanceId: booked }, context.sequence));
      return booked;
    });
    const { shows } = ask(
      engineOver(built),
      'calendar.range',
      { ...SIX_WEEKS, scope: 'mine' },
      AS_PLAYER_ONE,
    );
    expect(shows.map((show) => show.segmentCount)).toEqual(
      shows.map((show) => (show.eventInstanceId === built.kept ? 3 : 0)),
    );
  });

  it('sorts by date, then importance, then promotion name, then id', () => {
    const built = calendarWorldWith((context, { promotionA, promotionB, weekly }) => {
      const oneOff = (overrides: Parameters<typeof anEventInstance>[0]) =>
        context.insert(
          'eventInstances',
          anEventInstance({ date: SECOND_MONDAY, ...overrides }, context.sequence),
        ).id;
      // Inserted out of order on purpose.
      const house = oneOff({ promotionId: promotionA, importance: 'house' });
      const firstRegular = oneOff({ promotionId: promotionB, importance: 'regular' });
      const flagship = oneOff({ promotionId: promotionB, importance: 'flagship' });
      const secondRegular = oneOff({ promotionId: promotionB, importance: 'regular' });
      const earlier = oneOff({ promotionId: promotionB, importance: 'house', date: FIRST_FRIDAY });
      return {
        house,
        firstRegular,
        flagship,
        secondRegular,
        earlier,
        weekly: storedShowId(context, weekly, SECOND_MONDAY),
        friday: storedShowId(context, testId('eventDefinition', 4), FIRST_FRIDAY),
      };
    });
    const { kept } = built;
    expect(kept.firstRegular < kept.secondRegular).toBe(true);
    const { shows } = ask(
      engineOver(built),
      'calendar.range',
      { from: FIRST_FRIDAY, to: SECOND_MONDAY, scope: 'world' },
      OMNISCIENT,
    );
    expect(keysOf(shows)).toEqual([
      // Friday: the minor show before the house show.
      kept.friday,
      kept.earlier,
      // Monday: the flagship, then the regular shows by promotion name (A before B) and, inside
      // promotion B, by id; the house show last.
      kept.flagship,
      kept.weekly,
      kept.firstRegular,
      kept.secondRegular,
      kept.house,
    ]);
  });

  it('filters by promotion and by brand', () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const window = { ...SIX_WEEKS, scope: 'world' } as const;

    const rival = ask(
      engine,
      'calendar.range',
      { ...window, promotionId: built.promotionB },
      AS_PLAYER_ONE,
    );
    expect(rival.shows).toHaveLength(7);
    expect(rival.shows.every((show) => show.promotion.id === built.promotionB)).toBe(true);

    const brand = ask(engine, 'calendar.range', { ...window, brandId: built.brandA }, OMNISCIENT);
    expect(brand.shows).toHaveLength(6);
    expect(brand.shows.every((show) => show.brand?.id === built.brandA)).toBe(true);

    const neither = ask(
      engine,
      'calendar.range',
      { ...window, promotionId: built.promotionB, brandId: built.brandA },
      OMNISCIENT,
    );
    expect(neither.shows).toEqual([]);

    const rivalAsMine = ask(
      engine,
      'calendar.range',
      { ...SIX_WEEKS, scope: 'mine', promotionId: built.promotionB },
      AS_PLAYER_ONE,
    );
    expect(rivalAsMine.shows).toEqual([]);
  });

  it('includes both ends of the window and nothing outside it', () => {
    const engine = engineOver(calendarWorld());
    const { shows } = ask(
      engine,
      'calendar.range',
      { from: START, to: SECOND_MONDAY, scope: 'mine' },
      AS_PLAYER_ONE,
    );
    expect(shows.map((show) => show.date)).toEqual([START, SECOND_MONDAY]);
    const oneDay = ask(
      engine,
      'calendar.range',
      { from: FIRST_FRIDAY, to: FIRST_FRIDAY, scope: 'world' },
      AS_PLAYER_ONE,
    );
    expect(oneDay.shows.map((show) => show.date)).toEqual([FIRST_FRIDAY]);
  });

  it('refuses a window longer than 366 days, or one that ends before it starts, on "to"', () => {
    const engine = engineOver(calendarWorld());
    for (const name of ['calendar.range', 'calendar.projected'] as const) {
      expect(engine.query(name, { ...LONGEST, scope: 'world' }, OMNISCIENT).ok).toBe(true);
      expect(
        engine.query(name, { from: START, to: addDays(START, 367), scope: 'world' }, OMNISCIENT),
      ).toEqual({
        ok: false,
        reasons: [
          {
            code: 'invalidArgs',
            field: 'to',
            message: 'to: A calendar range can cover at most 366 days.',
          },
        ],
      });
      expect(
        engine.query(name, { from: SECOND_MONDAY, to: START, scope: 'world' }, OMNISCIENT),
      ).toEqual({
        ok: false,
        reasons: [
          { code: 'invalidArgs', field: 'to', message: `to: ${CALENDAR_RANGE_MESSAGES.backwards}` },
        ],
      });
    }
    expect(CALENDAR_RANGE_MESSAGES.tooLong).toBe('A calendar range can cover at most 366 days.');
  });

  it('refuses malformed arguments without throwing', () => {
    const engine = engineOver(calendarWorld());
    const bad: unknown[] = [
      {},
      { from: 'soon', to: START, scope: 'world' },
      { from: START, to: START, scope: 'everyone' },
      { from: START, to: START, scope: 'world', promotionId: 'not-a-promotion' },
      { from: START, to: START, scope: 'world', extra: 1 },
    ];
    for (const args of bad) {
      const result = engine.queryRaw('calendar.range', args, OMNISCIENT);
      expect(result.ok).toBe(false);
      const reasons = result.ok ? [] : result.reasons;
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons.every((reason) => reason.code === 'invalidArgs')).toBe(true);
    }
  });
});

describe('calendar viewer scoping', () => {
  it('gives the omniscient viewer every show, none of them its own', () => {
    const engine = engineOver(calendarWorld());
    const world = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, OMNISCIENT);
    expect(world.shows).toHaveLength(13);
    expect(world.shows.some((show) => show.isOwn || show.canCancel)).toBe(false);
    expect(
      ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'mine' }, OMNISCIENT).shows,
    ).toEqual([]);
    expect(
      ask(engine, 'calendar.projected', { ...LONGEST, scope: 'mine' }, OMNISCIENT).shows,
    ).toEqual([]);
    expect(ask(engine, 'calendar.nextShow', {}, OMNISCIENT)).toBeNull();
  });

  it('gives a computer seat the world view only', () => {
    const engine = engineOver(calendarWorld());
    const world = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, AS_COMPUTER);
    expect(world.shows).toHaveLength(13);
    // Not even the computer promotion's shows count as the seat's own.
    expect(world.shows.some((show) => show.isOwn || show.canCancel)).toBe(false);
    expect(
      ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'mine' }, AS_COMPUTER).shows,
    ).toEqual([]);
    expect(
      ask(engine, 'calendar.projected', { ...LONGEST, scope: 'mine' }, AS_COMPUTER).shows,
    ).toEqual([]);
    expect(ask(engine, 'calendar.nextShow', {}, AS_COMPUTER)).toBeNull();
    expect(ask(engine, 'calendar.nextShow', { scope: 'world' }, AS_COMPUTER)?.show.date).toBe(
      START,
    );
  });

  it('gives a player who runs nothing an empty mine and no show to cancel', () => {
    const engine = engineOver(calendarWorld());
    const world = ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'world' }, AS_PLAYER_TWO);
    expect(world.shows).toHaveLength(13);
    expect(world.shows.some((show) => show.isOwn || show.canCancel)).toBe(false);
    expect(
      ask(engine, 'calendar.range', { ...SIX_WEEKS, scope: 'mine' }, AS_PLAYER_TWO).shows,
    ).toEqual([]);
    expect(ask(engine, 'calendar.nextShow', {}, AS_PLAYER_TWO)).toBeNull();
  });

  it('lets the owner cancel only open shows dated today or later', () => {
    const built = calendarWorldWith(
      (context, { promotionA }) =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId: promotionA, date: gameDate('2026-01-20'), status: 'booked' },
            context.sequence,
          ),
        ).id,
      { currentDate: '2026-01-12' },
    );
    const { shows } = ask(
      engineOver(built),
      'calendar.range',
      { ...SIX_WEEKS, scope: 'mine' },
      AS_PLAYER_ONE,
    );
    // The show of 5 January is still open in this hand-built world, but its day has passed.
    expect(shows.map((show) => [show.date, show.canCancel])).toEqual([
      [START, false],
      [SECOND_MONDAY, true],
      ['2026-01-19', true],
      ['2026-01-20', true],
      ['2026-01-26', true],
      ['2026-02-02', true],
      ['2026-02-09', true],
    ]);
    expect(shows.find((show) => show.date === '2026-01-20')?.status).toBe('booked');
  });
});

describe('calendar.projected', () => {
  it('starts the day after the horizon and writes nothing', () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const before = engine.exportState();
    const view = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'world' }, AS_PLAYER_ONE);
    expect(engine.exportState()).toEqual(before);

    expect(view.today).toBe(START);
    expect(view.projectionEnd).toBe(addDays(START, 400));
    // 5 April, the horizon's last day, is a Sunday; the first projected show is Monday's.
    const firstProjectedDay = addDays(HORIZON_END, 1);
    const [first] = view.shows;
    expect(first?.promotion).toMatchObject({ id: built.promotionA, name: 'Test Promotion A' });
    expect({ ...first, promotion: null }).toEqual({
      key: `${built.weekly}|${firstProjectedDay}`,
      eventInstanceId: null,
      definitionId: built.weekly,
      promotion: null,
      isOwn: true,
      brand: { id: built.brandA, name: 'Test Brand One' },
      name: 'Test Weekly',
      importance: 'regular',
      format: { slots: 6, preShowSlots: 0 },
      televised: true,
      date: firstProjectedDay,
      airDate: firstProjectedDay,
      status: 'projected',
      cancellation: null,
      region: {
        id: built.homeRegion,
        name: 'Test Region North 1',
        countryName: 'Test Country North',
      },
      venue: null,
      segmentCount: 0,
      canCancel: false,
      score: null,
    });
    expect(view.shows.every((show) => compareDates(show.date, HORIZON_END) > 0)).toBe(true);
    expect(view.shows.every((show) => compareDates(show.date, LONGEST.to) <= 0)).toBe(true);
    expect(view.shows.every((show) => show.status === 'projected' && !show.canCancel)).toBe(true);
    expect(new Set(keysOf(view.shows)).size).toBe(view.shows.length);
    expectSerialisable(view);

    const mine = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'mine' }, AS_PLAYER_ONE);
    expect(mine.shows).toEqual(view.shows.filter((show) => show.isOwn));
    // Every Monday from 6 April 2026 through 4 January 2027.
    expect(mine.shows).toHaveLength(40);
  });

  it('places a projected show the way the schedule will', () => {
    const built = calendarWorld();
    const { shows } = ask(
      engineOver(built),
      'calendar.projected',
      { ...LONGEST, scope: 'world', promotionId: built.promotionB },
      AS_PLAYER_ONE,
    );
    const special = showOn(shows, built.monthly, '2026-04-26');
    expect(special).toMatchObject({
      key: `${built.monthly}|2026-04-26`,
      isOwn: false,
      importance: 'major',
      format: { slots: 8, preShowSlots: 1 },
      televised: false,
      region: { id: built.rivalRegion, countryName: 'Test Country South' },
      venue: { id: built.rivalVenue, name: 'Test Rival Arena', capacity: 12_000, kind: 'arena' },
    });
  });

  it('does not return a date again once it is stored', async () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const newlyStored = addDays(HORIZON_END, 1);
    const window = { ...LONGEST, scope: 'mine' } as const;
    expect(ask(engine, 'calendar.projected', window, AS_PLAYER_ONE).shows[0]?.date).toBe(
      newlyStored,
    );

    await advance(engine, 1);

    const projected = ask(engine, 'calendar.projected', window, AS_PLAYER_ONE);
    expect(projected.shows[0]?.date).toBe(addDays(newlyStored, 7));
    const stored = ask(engine, 'calendar.range', window, AS_PLAYER_ONE);
    expect(stored.horizonEnd).toBe(newlyStored);
    expect(stored.shows.at(-1)).toMatchObject({ date: newlyStored, status: 'scheduled' });
    const airings = [...stored.shows, ...projected.shows].map(
      (show) => `${String(show.definitionId)}|${show.airDate}`,
    );
    expect(new Set(airings).size).toBe(airings.length);
  });

  it('skips a stored show even when the horizon is shorter than what is stored', () => {
    const built = calendarWorld();
    const engine = engineOver(built, { 'calendar.scheduleHorizonDays': 0 });
    const view = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'mine' }, AS_PLAYER_ONE);
    // Everything through 5 April is already stored, so none of it is projected.
    expect(view.shows[0]?.date).toBe(addDays(HORIZON_END, 1));
  });

  it("stops at a definition's last active day", () => {
    const built = calendarWorld();
    const { shows } = ask(
      engineOver(built),
      'calendar.projected',
      { ...LONGEST, scope: 'world' },
      OMNISCIENT,
    );
    expect(FRIDAY_SHOW_ENDS).toBe('2026-04-20');
    expect(keysOf(shows.filter((show) => show.definitionId === built.friday))).toEqual([
      `${built.friday}|2026-04-10`,
      `${built.friday}|2026-04-17`,
    ]);
  });

  it('projects nothing for a dormant promotion', () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const world = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'world' }, OMNISCIENT);
    expect(world.shows.some((show) => show.promotion.id === built.promotionC)).toBe(false);
    const dormant = ask(
      engine,
      'calendar.projected',
      { ...LONGEST, scope: 'world', promotionId: built.promotionC },
      OMNISCIENT,
    );
    expect(dormant.shows).toEqual([]);
  });

  it('stops at the projection limit', () => {
    const engine = engineOver(calendarWorld(), { 'calendar.projectionMaxDays': 100 });
    const view = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'world' }, OMNISCIENT);
    expect(view.projectionEnd).toBe('2026-04-15');
    expect(view.shows.map((show) => [show.date, show.name])).toEqual([
      ['2026-04-06', 'Test Weekly'],
      ['2026-04-10', 'Test Friday Show'],
      ['2026-04-13', 'Test Weekly'],
    ]);
  });

  it('returns no shows when the projection limit is 0', () => {
    const engine = engineOver(calendarWorld(), { 'calendar.projectionMaxDays': 0 });
    const view = ask(engine, 'calendar.projected', { ...LONGEST, scope: 'world' }, OMNISCIENT);
    expect(view).toEqual({ today: START, projectionEnd: START, shows: [] });
  });

  it('returns no shows for a window inside the stored horizon', () => {
    const engine = engineOver(calendarWorld());
    const view = ask(engine, 'calendar.projected', { ...SIX_WEEKS, scope: 'world' }, OMNISCIENT);
    expect(view.shows).toEqual([]);
  });
});

describe('calendar.show', () => {
  it('returns the row with why the show is held where it is and how often it runs', () => {
    const built = calendarWorldWith((context, { weekly, monthly }) => ({
      weekly: storedShowId(context, weekly, SECOND_MONDAY),
      special: storedShowId(context, monthly, LAST_SUNDAY_OF_JANUARY),
    }));
    const engine = engineOver(built);

    const special = ask(
      engine,
      'calendar.show',
      { eventInstanceId: built.kept.special },
      AS_PLAYER_ONE,
    );
    const definition = built.world.tables.eventDefinitions.get(built.monthly);
    if (special === null || definition === undefined || special.placementTrace === null) {
      throw new Error('expected the special, its definition and its placement trace');
    }
    const placement = placeShow(built.world, definition, LAST_SUNDAY_OF_JANUARY);
    // The trace is the placement rule's own decision, replayed for this show's day.
    expect(special.placementTrace).toEqual(placement.trace);
    expect(special.placementTrace).toMatchObject({ kind: 'decision', chosen: 'preferredVenue' });
    expectTraceContains(
      { value: placement.value, trace: special.placementTrace },
      { kind: 'branch', label: 'The show has a preferred venue' },
    );
    expect(special.venue?.id).toBe(placement.value.venueId);
    expect(special.region.id).toBe(placement.value.regionId);
    expect(special.definition).toEqual({ recurrenceText: 'Last Sunday of every month' });
    expect(special).toMatchObject({ eventInstanceId: built.kept.special, isOwn: false });
    expectSerialisable(special);

    const weekly = ask(
      engine,
      'calendar.show',
      { eventInstanceId: built.kept.weekly },
      AS_PLAYER_ONE,
    );
    expect(weekly).toMatchObject({
      eventInstanceId: built.kept.weekly,
      isOwn: true,
      canCancel: true,
      definition: { recurrenceText: 'Every Monday' },
      placementTrace: { kind: 'decision', chosen: 'notChosen' },
    });
    expectSerialisable(weekly);
  });

  it('matches the row calendar.range returns for the same show', () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const { shows } = ask(
      engine,
      'calendar.range',
      { ...SIX_WEEKS, scope: 'world' },
      AS_PLAYER_ONE,
    );
    for (const row of shows) {
      const eventInstanceId = row.eventInstanceId;
      if (eventInstanceId === null) {
        throw new Error('a stored show has an id');
      }
      const detail = ask(engine, 'calendar.show', { eventInstanceId }, AS_PLAYER_ONE);
      expect(detail).toMatchObject(row);
    }
  });

  it('drops the placement trace once the show is no longer where the rule puts it', () => {
    const built = calendarWorldWith((context, { weekly, monthly, homeRegion, rivalRegion }) => {
      const otherVenue = context.insert(
        'venues',
        aVenue({ name: 'Test Open Hall', regionId: homeRegion }, context.sequence),
      ).id;
      const movedVenue = storedShowId(context, monthly, LAST_SUNDAY_OF_JANUARY);
      context.tx.update('eventInstances', movedVenue, { venueId: otherVenue });
      const movedRegion = storedShowId(context, weekly, SECOND_MONDAY);
      context.tx.update('eventInstances', movedRegion, { regionId: rivalRegion });
      return { movedVenue, movedRegion, otherVenue };
    });
    const engine = engineOver(built);

    const movedVenue = ask(
      engine,
      'calendar.show',
      { eventInstanceId: built.kept.movedVenue },
      OMNISCIENT,
    );
    expect(movedVenue?.venue).toMatchObject({ id: built.kept.otherVenue, name: 'Test Open Hall' });
    expect(movedVenue?.placementTrace).toBeNull();
    expect(movedVenue?.definition).toEqual({ recurrenceText: 'Last Sunday of every month' });

    const movedRegion = ask(
      engine,
      'calendar.show',
      { eventInstanceId: built.kept.movedRegion },
      OMNISCIENT,
    );
    expect(movedRegion?.region.id).toBe(built.rivalRegion);
    expect(movedRegion?.placementTrace).toBeNull();
  });

  it('has no trace, recurrence or televised flag for a one-off', () => {
    const built = calendarWorldWith(
      (context, { promotionA }) =>
        context.insert(
          'eventInstances',
          anEventInstance({ promotionId: promotionA, date: SECOND_MONDAY }, context.sequence),
        ).id,
    );
    const detail = ask(
      engineOver(built),
      'calendar.show',
      { eventInstanceId: built.kept },
      AS_PLAYER_ONE,
    );
    expect(detail).toMatchObject({
      key: built.kept,
      definitionId: null,
      televised: null,
      brand: null,
      isOwn: true,
      placementTrace: null,
      definition: null,
    });
    expectSerialisable(detail);
  });

  it('returns null for a show that does not exist and refuses a malformed id', () => {
    const engine = engineOver(calendarWorld());
    expect(
      ask(engine, 'calendar.show', { eventInstanceId: testId('eventInstance', 9999) }, OMNISCIENT),
    ).toBeNull();
    expect(
      engine.queryRaw('calendar.show', { eventInstanceId: 'not-a-show' }, OMNISCIENT),
    ).toMatchObject({ ok: false, reasons: [{ code: 'invalidArgs', field: 'eventInstanceId' }] });
  });
});

describe('calendar.nextShow', () => {
  it("returns today's show with 0 days to go, and defaults to the player's own shows", () => {
    const built = calendarWorld();
    const engine = engineOver(built);
    const next = ask(engine, 'calendar.nextShow', {}, AS_PLAYER_ONE);
    expect(next).toMatchObject({
      daysUntil: 0,
      show: { date: START, definitionId: built.weekly, isOwn: true, status: 'scheduled' },
    });
    expect(ask(engine, 'calendar.nextShow', { scope: 'mine' }, AS_PLAYER_ONE)).toEqual(next);
    expectSerialisable(next);
  });

  it('skips cancelled shows', () => {
    const built = calendarWorldWith((context, { weekly }) => storedShowId(context, weekly, START));
    const engine = engineOver(built);
    expect(
      engine.command('calendar.cancelShow', { eventInstanceId: built.kept }, PLAYER_ONE).ok,
    ).toBe(true);

    expect(ask(engine, 'calendar.nextShow', {}, AS_PLAYER_ONE)).toMatchObject({
      daysUntil: 7,
      show: { date: SECOND_MONDAY, definitionId: built.weekly },
    });
    // The rival's Friday show comes first in the world view.
    const world = ask(engine, 'calendar.nextShow', { scope: 'world' }, AS_PLAYER_ONE);
    expect(world).toMatchObject({
      daysUntil: 4,
      show: { date: FIRST_FRIDAY, definitionId: built.friday, isOwn: false },
    });
    expectSerialisable(world);
  });

  it('skips completed shows and open shows whose day has passed, and counts booked ones', () => {
    const built = calendarWorldWith(
      (context, { promotionA }) => {
        const oneOff = (overrides: Parameters<typeof anEventInstance>[0]) =>
          context.insert(
            'eventInstances',
            anEventInstance({ promotionId: promotionA, ...overrides }, context.sequence),
          ).id;
        oneOff({ date: gameDate('2026-01-08'), status: 'completed' });
        return oneOff({ date: gameDate('2026-01-09'), status: 'booked' });
      },
      { currentDate: '2026-01-07' },
    );
    // The weekly show of 5 January is still open in this hand-built world; its day has passed.
    expect(ask(engineOver(built), 'calendar.nextShow', {}, AS_PLAYER_ONE)).toMatchObject({
      daysUntil: 2,
      show: { eventInstanceId: built.kept, status: 'booked', date: '2026-01-09' },
    });
  });

  it('breaks a tie on the day with the calendar order', () => {
    const built = calendarWorldWith(
      (context, { promotionB }) =>
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId: promotionB, date: START, importance: 'flagship' },
            context.sequence,
          ),
        ).id,
    );
    const engine = engineOver(built);
    expect(ask(engine, 'calendar.nextShow', { scope: 'world' }, OMNISCIENT)?.show.key).toBe(
      built.kept,
    );
    expect(ask(engine, 'calendar.nextShow', {}, AS_PLAYER_ONE)?.show.definitionId).toBe(
      built.weekly,
    );
  });

  it('returns null when nothing is scheduled', () => {
    const empty = engineOver(lifecycleWorld());
    expect(ask(empty, 'calendar.nextShow', {}, AS_PLAYER_ONE)).toBeNull();
    expect(ask(empty, 'calendar.nextShow', { scope: 'world' }, OMNISCIENT)).toBeNull();

    // Every show of the player's own called off: nothing of theirs is next, the rival's still is.
    const built = calendarWorld();
    const engine = engineOver(built);
    for (const show of built.world.tables.eventInstances.values()) {
      if (show.promotionId === built.promotionA) {
        engine.command('calendar.cancelShow', { eventInstanceId: show.id }, PLAYER_ONE);
      }
    }
    expect(ask(engine, 'calendar.nextShow', {}, AS_PLAYER_ONE)).toBeNull();
    expect(ask(engine, 'calendar.nextShow', { scope: 'world' }, AS_PLAYER_ONE)).toMatchObject({
      show: { date: FIRST_FRIDAY },
    });
  });
});
