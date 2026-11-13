// The venue commands (EVT6-03). Design: docs/design/box-office.md#venue-commands-and-queries
import { describe, expect, it } from 'vitest';
import type { Engine } from '../../../src/core/api';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import type { EventInstanceId } from '../../../src/core/ids';
import { testId } from '../../support';
import { pickVenueFor, venuePickTraceRef, type VenueChoice } from '../../../src/systems/boxOffice';
import {
  COMPUTER,
  PLAYER,
  engineOn,
  showIn,
  venueCommandWorld,
  type ShowName,
} from './venueCommandWorld';

function setVenue(engine: Engine, show: EventInstanceId, choice: VenueChoice) {
  const result = engine.command('booking.setVenue', { eventInstanceId: show, choice }, PLAYER);
  assertSerialisable(result, 'booking.setVenue');
  return result;
}

function storedPick(engine: Engine, show: EventInstanceId) {
  const ref = venuePickTraceRef(show);
  return engine
    .exportState()
    .traces.full.find((entry) => entry.ref.kind === ref.kind && entry.ref.id === ref.id);
}

describe('booking.setVenue', () => {
  it('a real venue elsewhere moves the show to its region and records the booker’s choice', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const result = setVenue(engine, built.shows.mine, {
      kind: 'venue',
      venueId: built.venues.northTwoHall,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.venue).toMatchObject({
      kind: 'venue',
      name: 'North Two Hall',
      capacity: 2000,
      regionId: built.regions[1],
      choice: { kind: 'venue', venueId: built.venues.northTwoHall },
    });
    expect(result.events.map((event) => event.type)).toEqual(['show.venueChosen']);
    const show = showIn(engine, built.shows.mine);
    expect(show.venueId).toBe(built.venues.northTwoHall);
    expect(show.regionId).toBe(built.regions[1]);
    const trace = storedPick(engine, built.shows.mine);
    expect(JSON.stringify(trace)).toContain('Chosen by the booker');
  });

  it('a generic size clears the real venue and stays in the show’s region', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    expect(
      setVenue(engine, built.shows.mine, { kind: 'venue', venueId: built.venues.civicHall }).ok,
    ).toBe(true);
    const result = setVenue(engine, built.shows.mine, { kind: 'generic', tier: 'hall' });
    expect(result.ok).toBe(true);
    const show = showIn(engine, built.shows.mine);
    expect(show.venueId).toBeNull();
    expect(show.genericVenue).toEqual({ tier: 'hall', capacity: 1200 });
    expect(show.regionId).toBe(built.regions[0]);
  });

  it('works on the show dated today, which has not run yet', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    expect(setVenue(engine, built.shows.myToday, { kind: 'generic', tier: 'room' }).ok).toBe(true);
  });

  const refusals: readonly {
    readonly name: string;
    readonly show: ShowName;
    readonly choice: (built: ReturnType<typeof venueCommandWorld>) => VenueChoice;
    readonly code: string;
    readonly message?: string;
  }[] = [
    {
      name: 'a rival’s show',
      show: 'rival',
      choice: (built) => ({ kind: 'venue', venueId: built.venues.civicHall }),
      code: 'boxOffice.notYourShow',
    },
    {
      name: 'a completed show',
      show: 'myCompleted',
      choice: () => ({ kind: 'generic', tier: 'hall' }),
      code: 'boxOffice.showNotEditable',
      message: "This show can't change venue any more",
    },
    {
      name: 'a cancelled show',
      show: 'myCancelled',
      choice: () => ({ kind: 'generic', tier: 'hall' }),
      code: 'boxOffice.showNotEditable',
    },
    {
      name: 'a past show',
      show: 'myPast',
      choice: () => ({ kind: 'generic', tier: 'hall' }),
      code: 'boxOffice.showNotEditable',
    },
    {
      name: 'a closed venue',
      show: 'mine',
      choice: (built) => ({ kind: 'venue', venueId: built.venues.oldBarn }),
      code: 'boxOffice.venueClosed',
      message: 'Closed on that date',
    },
    {
      name: 'a rival’s exclusive venue',
      show: 'mine',
      choice: (built) => ({ kind: 'venue', venueId: built.venues.rivalDojo }),
      code: 'boxOffice.venueExclusive',
      message: 'Exclusive to Test Promotion B',
    },
    {
      name: 'a venue taken that night',
      show: 'mine',
      choice: (built) => ({ kind: 'venue', venueId: built.venues.bigArena }),
      code: 'boxOffice.venueTaken',
      message: 'Test Promotion B runs Rival Arena Night there that night',
    },
  ];

  for (const refusal of refusals) {
    it(`refuses ${refusal.name} and changes nothing`, () => {
      const built = venueCommandWorld();
      const engine = engineOn(built);
      const before = engine.exportState().world;
      const result = setVenue(engine, built.shows[refusal.show], refusal.choice(built));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reasons.map((reason) => reason.code)).toEqual([refusal.code]);
      if (refusal.message !== undefined) {
        expect(result.reasons[0]?.message).toBe(refusal.message);
      }
      expect(engine.exportState().world).toEqual(before);
    });
  }

  it('names the venue as the subject of an unavailable venue', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const result = setVenue(engine, built.shows.mine, {
      kind: 'venue',
      venueId: built.venues.rivalDojo,
    });
    expect(result.ok ? null : result.reasons[0]?.subject).toEqual({
      kind: 'venue',
      id: built.venues.rivalDojo,
    });
  });

  it('refuses an unknown generic size and a show that does not exist as bad arguments', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const badTier = engine.commandRaw(
      'booking.setVenue',
      { eventInstanceId: built.shows.mine, choice: { kind: 'generic', tier: 'castle' } },
      PLAYER,
    );
    expect(badTier.ok ? [] : badTier.reasons.map((reason) => reason.code)).toEqual(['invalidArgs']);
    const missing = setVenue(engine, testId('eventInstance', 999), {
      kind: 'generic',
      tier: 'hall',
    });
    expect(missing.ok ? [] : missing.reasons.map((reason) => reason.code)).toEqual(['invalidArgs']);
  });

  it('lets the computer choose for its own shows, and not for the player’s', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const own = engine.command(
      'booking.setVenue',
      { eventInstanceId: built.shows.rival, choice: { kind: 'generic', tier: 'hall' } },
      COMPUTER,
    );
    expect(own.ok).toBe(true);
    const theirs = engine.command(
      'booking.setVenue',
      { eventInstanceId: built.shows.mine, choice: { kind: 'generic', tier: 'hall' } },
      COMPUTER,
    );
    expect(theirs.ok ? [] : theirs.reasons.map((reason) => reason.code)).toEqual([
      'boxOffice.notYourShow',
    ]);
  });
});

describe('booking.autoVenue', () => {
  it('stores the game’s pick with its Why? and marks it automatic', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const expected = pickVenueFor(
      built.world,
      built.tunables,
      built.world.tables.eventInstances.require(built.shows.mine),
    );
    const events: unknown[] = [];
    engine.onEvent((event) => {
      if (event.type === 'show.venueChosen') events.push(event.payload);
    });
    const result = engine.command(
      'booking.autoVenue',
      { eventInstanceId: built.shows.mine },
      PLAYER,
    );
    assertSerialisable(result, 'booking.autoVenue');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1000 expected × 1.1 headroom: Civic Hall (1500) is the smallest that fits in the region.
    expect(expected.value).toBe(built.venues.civicHall);
    expect(result.data.venue.name).toBe('Civic Hall');
    expect(showIn(engine, built.shows.mine).venueId).toBe(built.venues.civicHall);
    expect(events).toEqual([
      {
        eventInstanceId: built.shows.mine,
        promotionId: built.promotions.A,
        venueId: built.venues.civicHall,
        genericTier: null,
        auto: true,
      },
    ]);
    expect(storedPick(engine, built.shows.mine)?.trace).toEqual(expected.trace);
  });

  it('is refused for a rival’s show and a completed show', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    for (const [show, code] of [
      ['rival', 'boxOffice.notYourShow'],
      ['myCompleted', 'boxOffice.showNotEditable'],
    ] as const) {
      const result = engine.command(
        'booking.autoVenue',
        { eventInstanceId: built.shows[show] },
        PLAYER,
      );
      expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual([code]);
    }
  });
});
