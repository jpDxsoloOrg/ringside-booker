import { initializeSettings } from '@/app/settings/settingsStore';
import type { SettingsStorage } from '@/app/settings/settingsStore';
import { REDUCED_MOTION_ATTRIBUTE } from '@/styles/useReducedMotion';

/** A settings storage that lives in memory, optionally starting with `initial` stored. */
export function memorySettingsStorage(initial: string | null = null): SettingsStorage {
  let stored = initial;
  return {
    read: () => stored,
    write: (serialized) => {
      stored = serialized;
    },
    remove: () => {
      stored = null;
    },
  };
}

/** Clears what the settings put on `<html>` and loads fresh settings from `storage`. */
export function resetSettingsForTest(storage: SettingsStorage = memorySettingsStorage()): void {
  const rootElement = document.documentElement;
  delete rootElement.dataset['theme'];
  rootElement.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
  rootElement.style.removeProperty('--ui-scale');
  initializeSettings(storage);
}
