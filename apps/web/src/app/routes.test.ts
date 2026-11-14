import { describe, expect, it } from 'vitest';
import { matchPath } from 'react-router-dom';
import { parseId } from '@ringside/engine';
import {
  CALENDAR_PARAMS,
  FINANCES_PARAMS,
  routePatterns,
  routes,
  SHOW_RESULTS_PARAMS,
  SHOW_RESULTS_ROUTE_PARAM,
  TITLE_ROUTE_PARAM,
} from './routes';

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

describe('routes.game.showResults', () => {
  const show = parseId('eventInstance', 'evi_0000000001');

  it('sits under Event history', () => {
    expect(routes.game.showResults(show)).toBe(`/game/event-history/${show}`);
    expect(routes.game.showResults(show).startsWith(`${routes.game.eventHistory()}/`)).toBe(true);
  });

  it('asks for the reveal only when told to', () => {
    expect(routes.game.showResults(show, { reveal: false })).toBe(`/game/event-history/${show}`);
    const url = new URL(routes.game.showResults(show, { reveal: true }), 'https://example.test');
    expect(url.searchParams.get(SHOW_RESULTS_PARAMS.reveal)).toBe('1');
  });

  it('matches the pattern the router registers', () => {
    expect(matchPath(routePatterns.showResults, routes.game.showResults(show))?.params).toEqual({
      [SHOW_RESULTS_ROUTE_PARAM]: show,
    });
  });
});

describe('routes.game.title', () => {
  const title = parseId('title', 'tit_0000000001');

  it('sits under Titles and matches the pattern the router registers', () => {
    expect(routes.game.title(title)).toBe(`/game/titles/${title}`);
    expect(matchPath(routePatterns.title, routes.game.title(title))?.params).toEqual({
      [TITLE_ROUTE_PARAM]: title,
    });
  });
});

describe('routes.game.finances', () => {
  it('is the bare path with no options', () => {
    expect(routes.game.finances()).toBe('/game/finances');
    expect(routes.game.finances({})).toBe('/game/finances');
  });

  it('links to a tab, and to the Ledger on a month and category', () => {
    expect(routes.game.finances({ tab: 'policies' })).toBe('/game/finances?tab=policies');
    expect(routes.game.finances({ tab: 'ledger', month: '2027-01', category: 'wages' })).toBe(
      '/game/finances?tab=ledger&month=2027-01&category=wages',
    );
  });

  it('uses the parameter names the screen reads', () => {
    const url = new URL(
      routes.game.finances({ tab: 'ledger', month: '2027-02', category: 'travel' }),
      'https://example.test',
    );
    expect(url.searchParams.get(FINANCES_PARAMS.tab)).toBe('ledger');
    expect(url.searchParams.get(FINANCES_PARAMS.month)).toBe('2027-02');
    expect(url.searchParams.get(FINANCES_PARAMS.category)).toBe('travel');
  });
});
