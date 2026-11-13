// The booking screen's queries. Design: docs/design/booking.md#queries
import { describe, expect, it } from 'vitest';
import type { Engine, QueryArgs, QueryData, QueryName, Viewer } from '../../../src/core/api';
import type { Traced } from '../../../src/core/trace/types';
import {
  BOOKING_UNAVAILABLE_REASON,
  type BookingCard,
  type BookingSlotView,
} from '../../../src/systems/booking';
import { testId } from '../../support';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import {
  AS_COMPUTER,
  AS_PLAYER_ONE,
  AS_PLAYER_TWO,
  bookingQueriesWorld,
  bookSix,
  engineOver,
  OMNISCIENT,
  person,
  START,
} from './queries-world';

/** Field names no booking result may have: a card is slots, never a running time (D-10). */
const FORBIDDEN_FIELD = /minute|length/i;

function fieldNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNamesOf);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([name, child]) => [name, ...fieldNamesOf(child)]);
}

function expectCleanResult(value: unknown): void {
  expectSerialisable(value);
  expect(fieldNamesOf(value).filter((name) => FORBIDDEN_FIELD.test(name))).toEqual([]);
}

function ask<Name extends QueryName>(
  engine: Engine,
  name: Name,
  args: QueryArgs<Name>,
  viewer: Viewer = AS_PLAYER_ONE,
): QueryData<Name> {
  const result = engine.query(name, args, viewer);
  if (!result.ok) {
    throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function refusalCodes<Name extends QueryName>(
  engine: Engine,
  name: Name,
  args: QueryArgs<Name>,
  viewer: Viewer,
): string[] {
  const result = engine.query(name, args, viewer);
  return result.ok ? [] : result.reasons.map((reason) => reason.code);
}

function mainSlots(card: BookingCard): BookingSlotView[] {
  return card.sections.find((section) => !section.preShow)?.slots ?? [];
}

function slotAt(card: BookingCard, preShow: boolean, slot: number): BookingSlotView {
  const found = card.sections
    .find((section) => section.preShow === preShow)
    ?.slots.find((view) => view.slot === slot);
  if (found === undefined) {
    throw new Error(`The card has no ${preShow ? 'pre-show' : 'main'} slot ${String(slot)}`);
  }
  return found;
}

function weightOf(view: BookingSlotView): Traced<number> {
  return { value: view.weight, trace: view.weightTrace };
}

describe('booking.card', () => {
  it('reads a 6-slot card as opener, midcard x3, semi-main and main event, with traces', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    const card = ask(engineOver(built.world), 'booking.card', { eventInstanceId: built.shows.six });

    expect(card.sections.map((section) => section.preShow)).toEqual([true, false]);
    const main = mainSlots(card);
    expect(main.map((view) => view.roleLabel)).toEqual([
      'Opener',
      'Midcard',
      'Midcard',
      'Midcard',
      'Semi-main',
      'Main event',
    ]);
    expect(main.map((view) => view.displayNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(main.map((view) => view.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const view of main) {
      expectTraceReplays(weightOf(view));
      expect(view.roleTrace.label).toBe('Slot role');
      expect(view.durationTrace.label).toBe('Duration class');
    }
    expect(slotAt(card, false, 5).durationLabel).toBe('Long');
    expectCleanResult(card);
  });

  it('reads a 3-slot card as opener, midcard and main event', () => {
    const built = bookingQueriesWorld();
    const card = ask(engineOver(built.world), 'booking.card', {
      eventInstanceId: built.shows.three,
    });
    // No pre-show section when the format has none.
    expect(card.sections.map((section) => section.preShow)).toEqual([false]);
    expect(mainSlots(card).map((view) => view.role)).toEqual(['opener', 'midcard', 'mainEvent']);
    expect(mainSlots(card).every((view) => view.segment === null)).toBe(true);
    expectCleanResult(card);
  });

  it('reads the pre-show slot as Pre-show', () => {
    const built = bookingQueriesWorld();
    const card = ask(engineOver(built.world), 'booking.card', { eventInstanceId: built.shows.six });
    const preShow = slotAt(card, true, 0);
    expect(preShow).toMatchObject({ preShow: true, role: 'preShow', roleLabel: 'Pre-show' });
    expectTraceReplays(weightOf(preShow));
  });

  it('lengthens a battle royal in a midcard slot, while a talking segment keeps the slot class', () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    const card = ask(engineOver(built.world), 'booking.card', { eventInstanceId: built.shows.six });
    const open = slotAt(card, false, 1);
    const battleRoyal = slotAt(card, false, 2);
    const promo = slotAt(card, false, 3);

    expect(open.durationClass).toBe('standard');
    expect(battleRoyal).toMatchObject({ role: 'midcard', durationClass: 'long' });
    expect(battleRoyal.durationLabel).toBe('Long');
    expect(battleRoyal.segment?.durationShiftNote).toBe(
      'Battle Royal runs a step longer than its slot',
    );
    expect(promo.segment?.kind).toBe('angle');
    expect(promo.durationClass).toBe(open.durationClass);
    expect(promo.segment?.durationShiftNote).toBeNull();
    expect(JSON.stringify(battleRoyal.durationTrace)).toContain('Battle Royal');
  });

  it('leaves open slots empty and fills booked ones with sides, titles and the plan', () => {
    const built = bookingQueriesWorld();
    const card = bookSix(built);
    const view = ask(engineOver(built.world), 'booking.card', { eventInstanceId: built.shows.six });
    expect(slotAt(view, false, 1).segment).toBeNull();
    expect(slotAt(view, false, 4).segment).toBeNull();

    const opener = slotAt(view, false, 0).segment;
    expect(opener).toMatchObject({
      segmentId: card.opener,
      kind: 'match',
      label: 'Title match',
      typeKey: 'match.singles',
      typeName: 'Singles',
      result: { kind: 'win', winningSide: 0, methodKey: 'method.pinfall', methodName: 'Pinfall' },
      titles: [{ titleId: built.title, holderIds: [person(built, 0)] }],
      finishKey: null,
      stipulationKeys: [],
    });
    // Ring names come from the contract with the show's promotion.
    expect(opener?.sides.map((side) => side.name)).toEqual([
      'Kid Vega',
      expect.not.stringMatching('Kid Vega'),
    ]);
    expect(opener?.sides[0]?.people[0]).toMatchObject({
      personId: person(built, 0),
      ringName: 'Kid Vega',
      availability: { status: 'available', label: 'Available' },
      otherBrand: false,
    });
    expect(opener?.draft.kind).toBe('match');

    const mainEvent = slotAt(view, false, 5).segment;
    expect(mainEvent?.sides.map((side) => [side.name, side.teamId])).toEqual([
      ['Test Team', built.team],
      [expect.stringContaining(' & '), null],
    ]);
    // Roster 5 is on Brand Three, the show is Brand One's.
    expect(mainEvent?.sides[1]?.people.map((entry) => entry.otherBrand)).toEqual([false, true]);

    const promo = slotAt(view, false, 3).segment;
    expect(promo?.sides[0]?.people[0]?.availability).toMatchObject({
      status: 'injured',
      label: 'Injured until 12 Feb',
      canWorkAngles: true,
    });
    expect(slotAt(view, true, 0).segment?.result).toEqual({
      kind: 'draw',
      winningSide: null,
      methodKey: null,
      methodName: null,
    });
  });

  it('lists the active titles by prestige, with holders, and the edit state', () => {
    const built = bookingQueriesWorld();
    const card = ask(engineOver(built.world), 'booking.card', { eventInstanceId: built.shows.six });
    expect(card.titleOptions.map((option) => [option.name, option.vacant])).toEqual([
      ['Test Heavyweight Title', false],
      ['Test Midcard Title', true],
    ]);
    expect(card.titleOptions[0]?.holderNames).toEqual(['Kid Vega']);
    expect(card).toMatchObject({
      canEdit: true,
      editBlock: null,
      locked: false,
      show: {
        eventInstanceId: built.shows.six,
        isToday: true,
        daysUntil: 0,
        brandName: 'Test Brand One',
        format: { slots: 6, preShowSlots: 1 },
      },
    });

    const past = ask(engineOver(built.world), 'booking.card', {
      eventInstanceId: built.shows.yesterday,
    });
    expect(past.canEdit).toBe(false);
    expect(past.editBlock?.code).toBe('showPast');
  });

  it("refuses a rival's card and a show that does not exist", () => {
    const built = bookingQueriesWorld();
    const engine = engineOver(built.world);
    expect(
      refusalCodes(engine, 'booking.card', { eventInstanceId: built.shows.rival }, AS_PLAYER_ONE),
    ).toEqual(['notYourShow']);
    expect(
      refusalCodes(engine, 'booking.card', { eventInstanceId: built.shows.six }, AS_PLAYER_TWO),
    ).toEqual(['notYourShow']);
    // Brand Two is run by the computer, even inside player-1's promotion.
    expect(
      refusalCodes(
        engine,
        'booking.card',
        { eventInstanceId: built.shows.brandTwo },
        AS_PLAYER_ONE,
      ),
    ).toEqual(['notYourShow']);
    expect(
      refusalCodes(
        engine,
        'booking.card',
        { eventInstanceId: testId('eventInstance', 9999) },
        AS_PLAYER_ONE,
      ),
    ).toEqual(['showNotFound']);
    // The omniscient viewer of tools and tests reads every card, but edits none.
    const seen = ask(engine, 'booking.card', { eventInstanceId: built.shows.rival }, OMNISCIENT);
    expect(seen.canEdit).toBe(false);
  });
});

describe('booking.shows', () => {
  it("lists only the viewer's own shows from today on, by date", () => {
    const built = bookingQueriesWorld();
    bookSix(built);
    const engine = engineOver(built.world);
    const view = ask(engine, 'booking.shows', {});
    expect(view.rows.map((row) => row.eventInstanceId)).toEqual([
      built.shows.six,
      built.shows.three,
    ]);
    expect(view.rows[0]).toEqual({
      eventInstanceId: built.shows.six,
      name: 'Test Monday Show',
      date: START,
      importance: view.rows[0]?.importance,
      brandName: 'Test Brand One',
      status: 'scheduled',
      filledMain: 4,
      slots: 6,
      filledPreShow: 1,
      preShowSlots: 1,
      needsBooking: true,
      locked: false,
    });
    expect(view.rows[1]?.needsBooking).toBe(false);
    expect(view).toMatchObject({
      nextToBookId: built.shows.six,
      available: true,
      unavailableReason: null,
    });
    expect(ask(engine, 'booking.shows', { limit: 1 }).rows).toHaveLength(1);
    expectCleanResult(view);
  });

  it('leaves cancelled shows out', () => {
    const built = bookingQueriesWorld();
    const result = built.world.transact('cancel the Wednesday show', (tx) => {
      tx.update('eventInstances', built.shows.three, {
        status: 'cancelled',
        cancellation: { reason: 'byPromotion', on: START },
      });
    });
    expect(result.ok).toBe(true);
    const view = ask(engineOver(built.world), 'booking.shows', {});
    expect(view.rows.map((row) => row.eventInstanceId)).toEqual([built.shows.six]);
  });

  it('honours brand controllers', () => {
    const built = bookingQueriesWorld();
    const engine = engineOver(built.world);
    // The computer runs promotion B and Brand Two.
    expect(
      ask(engine, 'booking.shows', {}, AS_COMPUTER).rows.map((row) => row.eventInstanceId),
    ).toEqual([built.shows.brandTwo, built.shows.rival]);
    expect(ask(engine, 'booking.shows', {}, AS_PLAYER_TWO).rows).toEqual([]);
  });

  it('is not available on a world without shows or without match types', () => {
    // A save from before EVT1 has no shows at all.
    const empty = bookingQueriesWorld();
    const removed = empty.world.transact('remove every show', (tx) => {
      for (const id of Object.values(empty.shows)) {
        tx.delete('eventInstances', id);
      }
    });
    expect(removed.ok).toBe(true);
    const noShows = ask(engineOver(empty.world), 'booking.shows', {});
    expect(noShows).toEqual({
      rows: [],
      nextToBookId: null,
      available: false,
      unavailableReason: BOOKING_UNAVAILABLE_REASON,
    });
    // A save from before MTCH1 has no match types.
    const noCatalogs = ask(
      engineOver(bookingQueriesWorld({ withoutCatalogs: true }).world),
      'booking.shows',
      {},
    );
    expect(noCatalogs.available).toBe(false);
    expect(noCatalogs.rows).toHaveLength(2);
  });

  it('refuses a limit outside 1..60', () => {
    const engine = engineOver(bookingQueriesWorld().world);
    expect(refusalCodes(engine, 'booking.shows', { limit: 0 }, AS_PLAYER_ONE)).toEqual([
      'invalidArgs',
    ]);
    expect(refusalCodes(engine, 'booking.shows', { limit: 61 }, AS_PLAYER_ONE)).toEqual([
      'invalidArgs',
    ]);
  });
});

describe('booking.availableWorkers', () => {
  it('marks an injured worker who may talk bookable for an angle but not for a match', () => {
    const built = bookingQueriesWorld();
    const engine = engineOver(built.world);
    const args = { eventInstanceId: built.shows.six } as const;
    const forMatch = ask(engine, 'booking.availableWorkers', { ...args, kind: 'match' });
    const forAngle = ask(engine, 'booking.availableWorkers', { ...args, kind: 'angle' });
    const rowOf = (rows: typeof forMatch.people, index: number) =>
      rows.find((row) => row.personId === person(built, index));

    expect(rowOf(forMatch.people, 2)).toMatchObject({
      bookable: false,
      availability: {
        status: 'injured',
        label: 'Injured until 12 Feb',
        reason: 'Injured (leg injury); can still do talking segments',
        canWorkAngles: true,
      },
    });
    expect(rowOf(forAngle.people, 2)?.bookable).toBe(true);
    expect(rowOf(forMatch.people, 3)?.bookable).toBe(false);
    expect(rowOf(forAngle.people, 3)?.bookable).toBe(false);
    // Every roster member, and nobody from promotion B.
    expect(forMatch.people).toHaveLength(6);
    expect(forMatch.people.some((row) => row.personId === built.outsider)).toBe(false);
    expectCleanResult(forMatch);
    expectCleanResult(forAngle);
  });

  it('sorts bookable first, then by push, and flags other brands', () => {
    const built = bookingQueriesWorld();
    const { people } = ask(engineOver(built.world), 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
    });
    expect(people.map((row) => row.bookable)).toEqual([true, true, true, true, false, false]);
    // Roster 4 is the only main eventer.
    expect(people[0]?.personId).toBe(person(built, 4));
    const sixth = people.find((row) => row.personId === person(built, 5));
    expect(sixth).toMatchObject({ otherBrand: true, brandName: 'Test Brand Three' });
    expect(people.find((row) => row.personId === person(built, 0))).toMatchObject({
      ringName: 'Kid Vega',
      otherBrand: false,
      brandId: built.brandOne,
      appearanceCap: null,
    });
  });

  it("gives each row its style, stamina and popularity in the show's region (EVT2-06)", () => {
    const built = bookingQueriesWorld();
    const view = ask(engineOver(built.world), 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
    });
    const show = built.world.tables.eventInstances.get(built.shows.six);
    expect(view.region.regionId).toBe(show?.regionId);
    expect(view.region.name).toBe(
      show === undefined ? undefined : built.world.tables.regions.get(show.regionId)?.name,
    );
    expect(view.people.find((row) => row.personId === person(built, 1))).toMatchObject({
      style: 'highFlyer',
      stamina: 72.4,
      popularity: 54.6,
    });
    // Everyone else reads their stored values; a region they are unknown in reads 0.
    for (const row of view.people) {
      const stored = built.world.tables.people.get(row.personId);
      expect(row.style).toBe(stored?.style);
      expect(row.stamina).toBe(stored?.attributes.stamina);
      expect(row.popularity).toBe(stored?.regionalPop[view.region.regionId] ?? 0);
    }
  });

  it('lists where each worker already is on the card', () => {
    const built = bookingQueriesWorld();
    const card = bookSix(built);
    const { people } = ask(engineOver(built.world), 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
    });
    expect(people.find((row) => row.personId === person(built, 0))?.onCard).toEqual([
      { segmentId: card.opener, slotLabel: 'Slot 1' },
      { segmentId: card.mainEvent, slotLabel: 'Slot 6' },
    ]);
    expect(people.find((row) => row.personId === person(built, 4))?.onCard).toEqual([
      { segmentId: card.preShow, slotLabel: 'Pre-show slot 1' },
      { segmentId: card.battleRoyal, slotLabel: 'Slot 3' },
      { segmentId: card.mainEvent, slotLabel: 'Slot 6' },
    ]);
    expect(people.find((row) => row.personId === person(built, 3))?.onCard).toEqual([]);
  });

  it('lists teams whose members all work here, and searches names', () => {
    const built = bookingQueriesWorld();
    const engine = engineOver(built.world);
    const all = ask(engine, 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
    });
    expect(all.teams).toEqual([
      {
        teamId: built.team,
        name: 'Test Team',
        kind: 'tag',
        memberIds: [person(built, 0), person(built, 1)],
        bookable: true,
      },
    ]);
    const searched = ask(engine, 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
      search: '  kid VEGA ',
    });
    expect(searched.people.map((row) => row.personId)).toEqual([person(built, 0)]);
    expect(searched.teams.map((team) => team.teamId)).toEqual([built.team]);
    const nobody = ask(engine, 'booking.availableWorkers', {
      eventInstanceId: built.shows.six,
      kind: 'match',
      search: 'zzz',
    });
    expect(nobody).toMatchObject({ people: [], teams: [] });
  });

  it("refuses a show the viewer doesn't run", () => {
    const built = bookingQueriesWorld();
    expect(
      refusalCodes(
        engineOver(built.world),
        'booking.availableWorkers',
        { eventInstanceId: built.shows.rival, kind: 'match' },
        AS_PLAYER_ONE,
      ),
    ).toEqual(['notYourShow']);
  });
});
