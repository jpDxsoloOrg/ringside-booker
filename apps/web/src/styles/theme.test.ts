import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMatchMedia } from '@/test/matchMedia';
import {
  applyTheme,
  applyUiScale,
  clampUiScale,
  DEFAULT_THEME,
  resolveTheme,
  SELECTABLE_THEME_PREFERENCES,
  SHIPPED_THEMES,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
// Stand-ins for two different resolved backgrounds; only dark ships today (D-11).
const LIGHT_BG = '#f6f5f3';
const DARK_BG = '#090d16';

/**
 * jsdom loads no stylesheets, so each test stands in for tokens.css by setting --color-bg on the
 * root element to whatever the theme blocks would resolve to at that moment.
 */
let themeColorMeta: HTMLMetaElement;

function setResolvedBackground(background: string): void {
  document.documentElement.style.setProperty('--color-bg', background);
}

beforeEach(() => {
  themeColorMeta = document.createElement('meta');
  themeColorMeta.name = 'theme-color';
  themeColorMeta.content = '#000000';
  document.head.append(themeColorMeta);
});

afterEach(() => {
  // Leave 'system' so the module drops its OS listener before the next test.
  applyTheme('light');
  delete document.documentElement.dataset['theme'];
  document.documentElement.removeAttribute('style');
  themeColorMeta.remove();
});

describe('applyTheme', () => {
  it("sets data-theme for 'dark' and 'light'", () => {
    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it("removes data-theme for 'system'", () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('copies the resolved background into the theme-color meta', () => {
    setResolvedBackground(` ${DARK_BG}`);
    applyTheme('dark');
    expect(themeColorMeta.content).toBe(DARK_BG);
  });

  it('leaves the theme-color meta alone when no background has resolved yet', () => {
    applyTheme('dark');
    expect(themeColorMeta.content).toBe('#000000');
  });

  it("refreshes the theme-color meta when the OS scheme changes under 'system'", () => {
    setResolvedBackground(LIGHT_BG);
    applyTheme('system');
    expect(themeColorMeta.content).toBe(LIGHT_BG);

    // Once the OS turns dark, the prefers-color-scheme block resolves --color-bg to the dark value.
    setResolvedBackground(DARK_BG);
    setMatchMedia((query) => query === DARK_QUERY);
    expect(themeColorMeta.content).toBe(DARK_BG);
  });

  it('stops following the OS once a theme is forced', () => {
    setResolvedBackground(LIGHT_BG);
    applyTheme('system');
    applyTheme('light');
    expect(themeColorMeta.content).toBe(LIGHT_BG);

    setResolvedBackground(DARK_BG);
    setMatchMedia((query) => query === DARK_QUERY);
    expect(themeColorMeta.content).toBe(LIGHT_BG);
  });
});

describe('resolveTheme', () => {
  it('ships dark only, as the default, with no theme choice to offer', () => {
    expect(SHIPPED_THEMES).toEqual(['dark']);
    expect(DEFAULT_THEME).toBe('dark');
    expect(SELECTABLE_THEME_PREFERENCES).toEqual(['dark']);
  });

  it('resolves every preference to dark while dark is the only shipped theme', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
  });
});

describe('applyUiScale', () => {
  it('sets --ui-scale on the root element', () => {
    applyUiScale(1.25);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25');
  });

  it('clamps to the supported range', () => {
    applyUiScale(3);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.5');

    applyUiScale(0.5);
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('0.8');
  });

  it('falls back to 1 for values that are not finite numbers', () => {
    expect(clampUiScale(Number.NaN)).toBe(1);
    expect(clampUiScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
