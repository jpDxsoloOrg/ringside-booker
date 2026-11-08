import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settingsSchema';
import {
  browserSettingsStorage,
  initializeSettings,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  useSettingsStore,
} from './settingsStore';
import type { SettingsStorage } from './settingsStore';

/** An in-memory storage that can be told to fail reads or writes. */
function memoryStorage(initial: string | null = null) {
  let stored = initial;
  const control = { failReads: false, failWrites: false };
  const storage: SettingsStorage = {
    read: () => {
      if (control.failReads) throw new Error('SecurityError: storage is blocked');
      return stored;
    },
    write: (serialized) => {
      if (control.failWrites) throw new Error('QuotaExceededError');
      stored = serialized;
    },
    remove: () => {
      if (control.failWrites) throw new Error('SecurityError: storage is blocked');
      stored = null;
    },
  };
  return { storage, control, stored: () => stored };
}

function storedSettings(text: string | null): unknown {
  return text === null ? null : JSON.parse(text);
}

beforeEach(() => {
  window.localStorage.clear();
  initializeSettings(memoryStorage().storage);
});

describe('loadSettings', () => {
  it('gives the defaults when nothing is stored, and leaves storage empty', () => {
    const memory = memoryStorage();
    expect(loadSettings(memory.storage)).toEqual({
      settings: DEFAULT_SETTINGS,
      persistence: 'ok',
    });
    expect(memory.stored()).toBeNull();
  });

  it('reads stored settings and writes back the cleaned-up value', () => {
    const memory = memoryStorage(JSON.stringify({ uiScale: 1.2, moneyStyle: 'full', junk: 1 }));
    const loaded = loadSettings(memory.storage);
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, uiScale: 1.2, moneyStyle: 'full' });
    expect(storedSettings(memory.stored())).toEqual(loaded.settings);
  });

  it('gives the defaults for stored text that is not JSON', () => {
    expect(loadSettings(memoryStorage('{not json').storage).settings).toEqual(DEFAULT_SETTINGS);
  });

  it('reports unavailable storage when reading throws', () => {
    const memory = memoryStorage();
    memory.control.failReads = true;
    expect(loadSettings(memory.storage)).toEqual({
      settings: DEFAULT_SETTINGS,
      persistence: 'unavailable',
    });
  });

  it('keeps what it read but reports unavailable storage when writing throws', () => {
    const memory = memoryStorage(JSON.stringify({ moneyStyle: 'full' }));
    memory.control.failWrites = true;
    expect(loadSettings(memory.storage)).toEqual({
      settings: { ...DEFAULT_SETTINGS, moneyStyle: 'full' },
      persistence: 'unavailable',
    });
  });

  it('notices storage that reads but will not write, even with nothing stored', () => {
    const memory = memoryStorage();
    memory.control.failWrites = true;
    expect(loadSettings(memory.storage).persistence).toBe('unavailable');
  });
});

describe('settings store', () => {
  it('updates, applies and saves a change', () => {
    const memory = memoryStorage();
    initializeSettings(memory.storage);

    useSettingsStore.getState().update({ uiScale: 1.25 });

    expect(useSettingsStore.getState().settings.uiScale).toBe(1.25);
    expect(storedSettings(memory.stored())).toEqual({ ...DEFAULT_SETTINGS, uiScale: 1.25 });
    expect(useSettingsStore.getState().persistence).toBe('ok');
  });

  it('ignores an invalid update', () => {
    useSettingsStore.getState().update({ uiScale: 4 });
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps working in memory when writing fails', () => {
    const memory = memoryStorage();
    initializeSettings(memory.storage);
    memory.control.failWrites = true;

    useSettingsStore.getState().update({ reducedMotion: 'on' });

    expect(useSettingsStore.getState().settings.reducedMotion).toBe('on');
    expect(useSettingsStore.getState().persistence).toBe('unavailable');
    expect(memory.stored()).toBeNull();
  });

  it('resets to the defaults and forgets the stored value', () => {
    const memory = memoryStorage(JSON.stringify({ moneyStyle: 'full', uiScale: 1.5 }));
    initializeSettings(memory.storage);
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.5);

    useSettingsStore.getState().reset();

    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(memory.stored()).toBeNull();
  });
});

describe('browserSettingsStorage', () => {
  it('reads and writes localStorage under rb.settings', () => {
    initializeSettings(browserSettingsStorage());
    useSettingsStore.getState().update({ moneyStyle: 'full' });

    expect(storedSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY))).toEqual({
      ...DEFAULT_SETTINGS,
      moneyStyle: 'full',
    });
    expect(initializeSettings(browserSettingsStorage()).moneyStyle).toBe('full');
  });
});
