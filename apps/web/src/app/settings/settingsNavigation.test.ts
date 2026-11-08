import { describe, expect, it } from 'vitest';
import { returnsToGame, settingsLinkState, settingsReturnPath } from './settingsNavigation';

describe('settingsReturnPath', () => {
  it('returns to the page the link came from', () => {
    expect(settingsReturnPath(settingsLinkState('/game/roster'))).toBe('/game/roster');
    expect(settingsReturnPath(settingsLinkState('/game/inbox?tab=unread'))).toBe(
      '/game/inbox?tab=unread',
    );
  });

  it.each([
    ['no state', null],
    ['a string', '/game/office'],
    ['no from', { other: '/game/office' }],
    ['a number', { from: 3 }],
    ['an outside URL', { from: 'https://example.com/' }],
    ['a protocol-relative URL', { from: '//example.com/' }],
    ['Settings itself', { from: '/settings' }],
    ['Settings with a query', { from: '/settings?x=1' }],
  ])('falls back to the title screen for %s', (_description, state) => {
    expect(settingsReturnPath(state)).toBe('/');
  });
});

describe('returnsToGame', () => {
  it('tells game screens from the rest', () => {
    expect(returnsToGame('/game/office')).toBe(true);
    expect(returnsToGame('/game')).toBe(true);
    expect(returnsToGame('/')).toBe(false);
    expect(returnsToGame('/gameplay')).toBe(false);
  });
});
