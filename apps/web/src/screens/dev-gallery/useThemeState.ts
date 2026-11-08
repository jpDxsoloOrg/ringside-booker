import { useSyncExternalStore } from 'react';
import type { ThemePreference } from '@/styles/theme';

/** The theme actually on screen once 'system' is resolved against the OS setting. */
export type EffectiveTheme = 'light' | 'dark';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Calls `onChange` when `data-theme` on `<html>` changes or the OS colour scheme flips. The
 * gallery reads the theme from the document, so it stays right whoever applied it.
 */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const darkSchemeList =
    typeof window.matchMedia === 'function' ? window.matchMedia(DARK_SCHEME_QUERY) : null;
  darkSchemeList?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    darkSchemeList?.removeEventListener('change', onChange);
  };
}

/** The preference `applyTheme` last put into effect, read back from `<html>`. */
export function readThemePreference(): ThemePreference {
  const attribute = document.documentElement.dataset['theme'];
  return attribute === 'light' || attribute === 'dark' ? attribute : 'system';
}

/** The theme on screen: the forced one, or the OS preference when following the system. */
export function readEffectiveTheme(): EffectiveTheme {
  const preference = readThemePreference();
  if (preference !== 'system') return preference;
  const prefersDark =
    typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches;
  return prefersDark ? 'dark' : 'light';
}

function serverPreference(): ThemePreference {
  return 'system';
}

function serverEffectiveTheme(): EffectiveTheme {
  return 'light';
}

/** The current theme preference, kept current as it changes. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeToTheme, readThemePreference, serverPreference);
}

/** The theme on screen, kept current as the preference or the OS setting changes. */
export function useEffectiveTheme(): EffectiveTheme {
  return useSyncExternalStore(subscribeToTheme, readEffectiveTheme, serverEffectiveTheme);
}
