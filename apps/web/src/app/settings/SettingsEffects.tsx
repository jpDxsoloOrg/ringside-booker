import { useEffect } from 'react';
import {
  applyTheme,
  applyUiScale,
  DEFAULT_THEME,
  SELECTABLE_THEME_PREFERENCES,
} from '@/styles/theme';
import type { ThemePreference } from '@/styles/theme';
import { REDUCED_MOTION_ATTRIBUTE } from '@/styles/useReducedMotion';
import type { ReducedMotionPreference, SettingsV1 } from './settingsSchema';
import { useSettings } from './settingsStore';

/**
 * The theme preference that is actually applied. A stored choice the build no longer offers (a
 * `light` saved while the game is dark only, D-11) falls back to the default theme rather than
 * leaving a `data-theme` on `<html>` that no tokens answer.
 */
export function effectiveThemePreference(preference: ThemePreference): ThemePreference {
  return SELECTABLE_THEME_PREFERENCES.includes(preference) ? preference : DEFAULT_THEME;
}

/**
 * Sets the motion override on `<html>`, which global.css and `useReducedMotion` both read:
 * - `on`: `data-reduced-motion="on"`, the motion tokens drop to 0ms whatever the OS says.
 * - `off`: `data-reduced-motion="off"`, which restores the motion tokens even when the OS asks for
 *   reduced motion (global.css only zeroes them under the media query when the attribute is not
 *   `off`).
 * - `system`: no attribute, so the `prefers-reduced-motion` media query decides.
 */
export function applyReducedMotion(preference: ReducedMotionPreference): void {
  const rootElement = document.documentElement;
  if (preference === 'system') {
    rootElement.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
  } else {
    rootElement.setAttribute(REDUCED_MOTION_ATTRIBUTE, preference);
  }
}

/** Puts every document-level preference into effect: theme, UI scale and motion. */
export function applySettingsToDocument(settings: SettingsV1): void {
  applyTheme(effectiveThemePreference(settings.theme));
  applyUiScale(settings.uiScale);
  applyReducedMotion(settings.reducedMotion);
}

/**
 * Keeps `<html>` in step with the settings store. Mounted once at the root of the route tree;
 * main.tsx has already applied the stored settings before the first render, so this only reacts
 * to changes. Money style needs nothing here: `useMoneyFormatter` reads the store directly.
 */
export function SettingsEffects(): null {
  const settings = useSettings();

  useEffect(() => {
    applySettingsToDocument(settings);
  }, [settings]);

  return null;
}
