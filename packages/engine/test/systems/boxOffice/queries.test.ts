// The forecast and venue queries (EVT6-03). Design: docs/design/box-office.md#venue-commands-and-queries
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER, type Engine } from '../../../src/core/api';
import { controllerViewer } from '../../../src/core/api/controller';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import type { EventInstanceId } from '../../../src/core/ids';
import type { VenueChoice } from '../../../src/systems/boxOffice';
import { CROWD, PLAYER, engineOn, showIn, venueCommandWorld } from './venueCommandWorld';

const ME = controllerViewer(PLAYER);

function forecast(engine: Engine, show: EventInstanceId, choice?: VenueChoice, viewer = ME) {
  const result = engine.query(
    'boxOffice.forecast',
    choice === undefined ? { eventInstanceId: show } : { eventInstanceId: show, choice },
    viewer,
  );
  assertSerialisable(result, 'boxOffice.forecast');
  return result;
}

describe('boxOffice.forecast', () => {
  it('without a venue, forecasts at the suggested venue and returns the pick’s Why?', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const result = forecast(engine, built.shows.mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.current).toBeNull();
    expect(result.data.suggested?.name).toBe('Civic Hall');
    expect(result.data.shown).toEqual(result.data.suggested);
    expect(result.data).toMatchObject({
      expected: CROWD,
      demand: CROWD,
      low: 900,
      high: 1100,
      capacity: 1500,
      cappedByCapacity: false,
      fit: 'goodFit',
      fitLabel: 'Good fit',
    });
    expect(result.data.trace.label).toBeTruthy();
    expect(result.data.pickTrace).not.toBeNull();
  });

  it('the suggested venue is what Pick for me then stores', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const before = forecast(engine, built.shows.mine);
    const picked = engine.command(
      'booking.autoVenue',
      { eventInstanceId: built.shows.mine },
      PLAYER,
    );
    expect(before.ok && picked.ok).toBe(true);
    if (!before.ok || !picked.ok) return;
    expect(picked.data.venue).toEqual(before.data.suggested);
    const after = forecast(engine, built.shows.mine);
    expect(
      after.ok ? [after.data.current, after.data.suggested, after.data.pickTrace] : null,
    ).toEqual([picked.data.venue, null, null]);
  });

  it('caps the range at a small venue', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const result = forecast(engine, built.shows.mine, {
      kind: 'venue',
      venueId: built.venues.smallClub,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      capacity: 300,
      expected: 300,
      demand: CROWD,
      low: 300,
      high: 300,
      cappedByCapacity: true,
      fit: 'likelySellOut',
    });
  });

  it('a choice previews without writing anything', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const before = engine.exportState();
    const result = forecast(engine, built.shows.mine, {
      kind: 'venue',
      venueId: built.venues.southDome,
    });
    expect(result.ok ? result.data.shown.regionId : null).toBe(built.regions[2]);
    expect(engine.exportState()).toEqual(before);
    expect(showIn(engine, built.shows.mine).venueId).toBeNull();
  });

  it('refuses a rival’s show, and lets the omniscient viewer forecast any show', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const refused = forecast(engine, built.shows.rival);
    expect(refused.ok ? [] : refused.reasons).toEqual([
      {
        code: 'boxOffice.notYourShow',
        message: 'Only your own shows have a crowd forecast',
        subject: { kind: 'eventInstance', id: built.shows.rival },
      },
    ]);
    for (const show of [built.shows.rival, built.shows.mine, built.shows.rivalAtArena]) {
      expect(forecast(engine, show, undefined, OMNISCIENT_VIEWER).ok).toBe(true);
    }
  });
});

describe('boxOffice.venues', () => {
  it('lists the country’s venues and the generic sizes, flagging the ones that cannot be booked', () => {
    const built = venueCommandWorld({ preferred: 'bigArena' });
    const engine = engineOn(built);
    const result = engine.query(
      'boxOffice.venues',
      { eventInstanceId: built.shows.mine, scope: 'country' },
      ME,
    );
    assertSerialisable(result, 'boxOffice.venues');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { options } = result.data;
    expect(options.map((option) => [option.group, option.name])).toEqual([
      ['region', 'Small Club'],
      ['region', 'Rival Dojo'],
      ['region', 'Old Barn'],
      ['region', 'Civic Hall'],
      ['region', 'Big Arena'],
      ['country', 'North Two Hall'],
      ['generic', 'Local room, Test Region North 1'],
      ['generic', 'Local small hall, Test Region North 1'],
      ['generic', 'Local hall, Test Region North 1'],
      ['generic', 'Local large hall, Test Region North 1'],
      ['generic', 'Local small arena, Test Region North 1'],
      ['generic', 'Local arena, Test Region North 1'],
      ['generic', 'Local large arena, Test Region North 1'],
      ['generic', 'Local stadium, Test Region North 1'],
    ]);
    const byName = new Map(options.map((option) => [option.name, option]));
    expect(byName.get('Rival Dojo')?.disabled).toEqual({
      code: 'boxOffice.venueExclusive',
      message: 'Exclusive to Test Promotion B',
    });
    expect(byName.get('Old Barn')?.disabled?.code).toBe('boxOffice.venueClosed');
    expect(byName.get('Big Arena')).toMatchObject({
      preferred: true,
      disabled: {
        code: 'boxOffice.venueTaken',
        message: 'Test Promotion B runs Rival Arena Night there that night',
      },
    });
    expect(byName.get('Civic Hall')).toMatchObject({
      disabled: null,
      fit: 'goodFit',
      expected: CROWD,
    });
    expect(byName.get('Small Club')).toMatchObject({ high: 300, fit: 'likelySellOut' });
    expect(options.filter((option) => option.current)).toEqual([]);
    expect(result.data.suggested).not.toBeNull();
  });

  it('adds venues abroad for the world scope and marks the current venue', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    expect(
      engine.command(
        'booking.setVenue',
        { eventInstanceId: built.shows.mine, choice: { kind: 'generic', tier: 'largeHall' } },
        PLAYER,
      ).ok,
    ).toBe(true);
    const result = engine.query(
      'boxOffice.venues',
      { eventInstanceId: built.shows.mine, scope: 'world' },
      ME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.options.find((option) => option.group === 'abroad')?.name).toBe(
      'South Dome',
    );
    expect(
      result.data.options.filter((option) => option.current).map((option) => option.choice),
    ).toEqual([{ kind: 'generic', tier: 'largeHall' }]);
    expect(result.data.suggested).toBeNull();
    expect(result.data.current?.name).toBe('Local large hall, Test Region North 1');
  });

  it('refuses a rival’s show', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const result = engine.query(
      'boxOffice.venues',
      { eventInstanceId: built.shows.rival, scope: 'country' },
      ME,
    );
    expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual([
      'boxOffice.notYourShow',
    ]);
  });
});

describe('boxOffice.showVenue', () => {
  it('tells anyone where a show is held, and null when no venue is chosen', () => {
    const built = venueCommandWorld();
    const engine = engineOn(built);
    const rival = engine.query(
      'boxOffice.showVenue',
      { eventInstanceId: built.shows.rivalAtArena },
      ME,
    );
    expect(rival.ok ? rival.data.venue?.name : null).toBe('Big Arena');
    expect(rival.ok ? rival.data.venue?.countryName : null).toBeTruthy();
    const mine = engine.query('boxOffice.showVenue', { eventInstanceId: built.shows.mine }, ME);
    expect(mine.ok ? mine.data.venue : 'refused').toBeNull();
  });
});
