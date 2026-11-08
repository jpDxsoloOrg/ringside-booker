import { create } from 'zustand';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings } from './settingsSchema';
import type { SettingsPatch, SettingsV1 } from './settingsSchema';

/** The localStorage key the preferences live under. */
export const SETTINGS_STORAGE_KEY = 'rb.settings';

/**
 * Where preferences are kept between visits. Each method may throw: private browsing, blocked
 * site data or a full quota all surface as exceptions from localStorage.
 */
export interface SettingsStorage {
  read(): string | null;
  write(serialized: string): void;
  remove(): void;
}

/** `unavailable` when this browser will not keep the settings, so they last until the tab closes. */
export type SettingsPersistence = 'ok' | 'unavailable';

/**
 * The browser's localStorage. `window.localStorage` itself is read inside each call because merely
 * touching it throws in some locked-down browsers.
 */
export function browserSettingsStorage(): SettingsStorage {
  return {
    read: () => window.localStorage.getItem(SETTINGS_STORAGE_KEY),
    write: (serialized) => {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
    },
    remove: () => {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    },
  };
}

export interface LoadedSettings {
  readonly settings: SettingsV1;
  readonly persistence: SettingsPersistence;
}

function parseStoredText(storedText: string | null): SettingsV1 {
  if (storedText === null) return DEFAULT_SETTINGS;
  try {
    const stored: unknown = JSON.parse(storedText);
    return parseSettings(stored);
  } catch {
    // Not JSON at all: treat it like any other unreadable value.
    return DEFAULT_SETTINGS;
  }
}

/**
 * Reads and validates the stored settings, then proves the storage can be written: a stored value
 * is written back validated (which also cleans up a hand-edited or partly invalid entry), and with
 * nothing stored a write is tried and undone, so the defaults are never pinned in storage. If any
 * step throws, the defaults or what was read stay in memory and persistence is `unavailable`.
 */
export function loadSettings(storage: SettingsStorage): LoadedSettings {
  let storedText: string | null;
  try {
    storedText = storage.read();
  } catch {
    return { settings: DEFAULT_SETTINGS, persistence: 'unavailable' };
  }
  const settings = parseStoredText(storedText);
  try {
    storage.write(JSON.stringify(settings));
    if (storedText === null) storage.remove();
  } catch {
    return { settings, persistence: 'unavailable' };
  }
  return { settings, persistence: 'ok' };
}

export interface SettingsState {
  readonly settings: SettingsV1;
  readonly persistence: SettingsPersistence;
  /** Changes some preferences, applies them at once and saves them. Invalid values are ignored. */
  readonly update: (patch: SettingsPatch) => void;
  /** Back to every default, and forgets what was stored. */
  readonly reset: () => void;
}

/** Swapped by {@link initializeSettings}; tests pass an in-memory or a broken one. */
let activeStorage: SettingsStorage | null = null;

function persist(write: (storage: SettingsStorage) => void): SettingsPersistence {
  if (activeStorage === null) return 'unavailable';
  try {
    write(activeStorage);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/**
 * UI-only viewer preferences (theme, UI scale, motion, money style). The store keeps working in
 * memory when storage fails; `persistence` tells the settings screen to say so.
 *
 * Call {@link initializeSettings} once before the first render; until then it holds the defaults.
 */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  persistence: 'ok',
  update: (patch) => {
    const settings = mergeSettings(get().settings, patch);
    const persistence = persist((storage) => {
      storage.write(JSON.stringify(settings));
    });
    set({ settings, persistence });
  },
  reset: () => {
    const persistence = persist((storage) => {
      storage.remove();
    });
    set({ settings: DEFAULT_SETTINGS, persistence });
  },
}));

/**
 * Loads the stored preferences into the store, synchronously. main.tsx calls it before the first
 * render so the right theme and scale are on screen from the first paint.
 */
export function initializeSettings(
  storage: SettingsStorage = browserSettingsStorage(),
): SettingsV1 {
  activeStorage = storage;
  const { settings, persistence } = loadSettings(storage);
  useSettingsStore.setState({ settings, persistence });
  return settings;
}

/** The current preferences, kept current as they change. */
export function useSettings(): SettingsV1 {
  return useSettingsStore((state) => state.settings);
}
