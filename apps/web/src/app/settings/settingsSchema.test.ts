import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, snapUiScale } from './settingsSchema';
import type { SettingsV1 } from './settingsSchema';

const CUSTOM_SETTINGS: SettingsV1 = {
  version: 1,
  theme: 'system',
  uiScale: 1.25,
  reducedMotion: 'on',
  moneyStyle: 'full',
  openResultsAfterShow: false,
  revealOneAtATime: false,
};

describe('parseSettings', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'dark mode please'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
    ['a function', () => 'settings'],
  ])('gives the defaults for garbage: %s', (_description, input) => {
    expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a fully valid object', () => {
    expect(parseSettings(CUSTOM_SETTINGS)).toEqual(CUSTOM_SETTINGS);
  });

  it('defaults an out-of-range scale and keeps the other fields', () => {
    expect(parseSettings({ ...CUSTOM_SETTINGS, uiScale: 3 })).toEqual({
      ...CUSTOM_SETTINGS,
      uiScale: DEFAULT_SETTINGS.uiScale,
    });
  });

  it.each([0.8, 1.5])('keeps the boundary scale %s', (uiScale) => {
    expect(parseSettings({ ...CUSTOM_SETTINGS, uiScale }).uiScale).toBe(uiScale);
  });

  it.each([0.79, 1.51, Number.NaN, Number.POSITIVE_INFINITY, '1.25'])(
    'rejects the scale %s',
    (uiScale) => {
      expect(parseSettings({ ...CUSTOM_SETTINGS, uiScale }).uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    },
  );

  it('snaps a scale between steps to the nearest 5%', () => {
    expect(parseSettings({ uiScale: 1.23 }).uiScale).toBe(1.25);
    expect(parseSettings({ uiScale: 0.8 + 0.05 * 3 }).uiScale).toBe(0.95);
  });

  it('defaults each invalid field on its own', () => {
    expect(
      parseSettings({ theme: 'sepia', uiScale: 1.1, reducedMotion: true, moneyStyle: 'full' }),
    ).toEqual({
      version: 1,
      theme: DEFAULT_SETTINGS.theme,
      uiScale: 1.1,
      reducedMotion: DEFAULT_SETTINGS.reducedMotion,
      moneyStyle: 'full',
      openResultsAfterShow: DEFAULT_SETTINGS.openResultsAfterShow,
      revealOneAtATime: DEFAULT_SETTINGS.revealOneAtATime,
    });
  });

  it('drops unknown extra keys', () => {
    const parsed = parseSettings({ ...CUSTOM_SETTINGS, saveSlot: 'slot-1', debug: true });
    expect(parsed).toEqual(CUSTOM_SETTINGS);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'moneyStyle',
        'openResultsAfterShow',
        'reducedMotion',
        'revealOneAtATime',
        'theme',
        'uiScale',
        'version',
      ].sort(),
    );
  });

  it('always writes the current version, whatever was stored', () => {
    expect(parseSettings({ ...CUSTOM_SETTINGS, version: 7 }).version).toBe(1);
  });
});

describe('mergeSettings', () => {
  it('applies valid fields and leaves the rest', () => {
    expect(mergeSettings(CUSTOM_SETTINGS, { moneyStyle: 'compact' })).toEqual({
      ...CUSTOM_SETTINGS,
      moneyStyle: 'compact',
    });
  });

  it('ignores an invalid value rather than resetting the field', () => {
    expect(mergeSettings(CUSTOM_SETTINGS, { uiScale: 9 })).toEqual(CUSTOM_SETTINGS);
  });
});

describe('snapUiScale', () => {
  it('rounds float noise away', () => {
    expect(snapUiScale(1 + 0.05 + 0.05 + 0.05)).toBe(1.15);
    expect(snapUiScale(1.249999)).toBe(1.25);
  });
});

describe('openResultsAfterShow (EVT3-09)', () => {
  it('is on by default and kept when stored', () => {
    expect(DEFAULT_SETTINGS.openResultsAfterShow).toBe(true);
    expect(parseSettings({ openResultsAfterShow: false }).openResultsAfterShow).toBe(false);
  });

  it('falls back to on for a value that is not true or false, keeping the other fields', () => {
    const parsed = parseSettings({ openResultsAfterShow: 'yes', moneyStyle: 'full' });
    expect(parsed.openResultsAfterShow).toBe(true);
    expect(parsed.moneyStyle).toBe('full');
  });
});

describe('revealOneAtATime (EVT3-10)', () => {
  it('is on by default and kept when stored', () => {
    expect(DEFAULT_SETTINGS.revealOneAtATime).toBe(true);
    expect(parseSettings({ revealOneAtATime: false }).revealOneAtATime).toBe(false);
  });

  it('falls back to on for a value that is not true or false, keeping the other fields', () => {
    const parsed = parseSettings({ revealOneAtATime: 1, openResultsAfterShow: false });
    expect(parsed.revealOneAtATime).toBe(true);
    expect(parsed.openResultsAfterShow).toBe(false);
  });
});
