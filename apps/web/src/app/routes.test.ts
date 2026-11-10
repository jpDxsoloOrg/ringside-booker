import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import { CALENDAR_PARAMS, routes } from './routes';

describe('routes.game.calendarAt', () => {
  const show = parseId('eventInstance', 'evi_0000000001');

  it('is the calendar itself with no options', () => {
    expect(routes.game.calendarAt()).toBe(routes.game.calendar());
    expect(routes.game.calendarAt({})).toBe('/game/calendar');
  });

  it('links to a month', () => {
    expect(routes.game.calendarAt({ month: '2027-01' })).toBe('/game/calendar?month=2027-01');
  });

  it('links to a scope', () => {
    expect(routes.game.calendarAt({ scope: 'world' })).toBe('/game/calendar?scope=world');
    expect(routes.game.calendarAt({ scope: 'mine' })).toBe('/game/calendar?scope=mine');
  });

  it('links straight to a show’s sheet', () => {
    expect(routes.game.calendarAt({ show })).toBe(`/game/calendar?show=${show}`);
  });

  it('puts month, scope and show in that order', () => {
    expect(routes.game.calendarAt({ show, scope: 'world', month: '2027-12' })).toBe(
      `/game/calendar?month=2027-12&scope=world&show=${show}`,
    );
  });

  it('uses the parameter names the screen reads', () => {
    const url = new URL(
      routes.game.calendarAt({ month: '2027-01', scope: 'world', show }),
      'https://example.test',
    );
    expect(url.searchParams.get(CALENDAR_PARAMS.month)).toBe('2027-01');
    expect(url.searchParams.get(CALENDAR_PARAMS.scope)).toBe('world');
    expect(url.searchParams.get(CALENDAR_PARAMS.show)).toBe(show);
  });
});
