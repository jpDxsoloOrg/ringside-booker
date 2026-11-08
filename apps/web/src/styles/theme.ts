/**
 * Applies the theme and UI scale preferences to the document. Choosing and saving them is the
 * settings screen's job; this module only puts a chosen value into effect.
 */

/** 'system' follows the OS light or dark setting; the others force a theme. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * The themes tokens.css actually defines. The game ships dark only for now (design decision
 * D-11). Adding a light theme means a `[data-theme='light']` block in tokens.css, 'light' here
 * and in SHIPPED_THEMES, and the choices it brings back in SELECTABLE_THEME_PREFERENCES.
 */
export type ThemeName = 'dark';

export const SHIPPED_THEMES: readonly ThemeName[] = ['dark'];

/** The theme on :root, and what any preference resolves to when its theme does not ship. */
export const DEFAULT_THEME: ThemeName = 'dark';

/**
 * The preferences a player can pick from. With one shipped theme there is nothing to choose, so
 * settings and the gallery hide the choice while this has fewer than two entries.
 */
export const SELECTABLE_THEME_PREFERENCES: readonly ThemePreference[] = ['dark'];

function isShippedTheme(theme: string): theme is ThemeName {
  return SHIPPED_THEMES.some((shippedTheme) => shippedTheme === theme);
}

/**
 * The theme a preference puts on screen. 'system' asks for whichever theme matches the OS
 * setting; a theme that does not ship falls back to DEFAULT_THEME, which is what the tokens show
 * in that case too (there is no block for it, so the :root values apply).
 */
export function resolveTheme(preference: ThemePreference, osPrefersDark: boolean): ThemeName {
  const requestedTheme = preference === 'system' ? (osPrefersDark ? 'dark' : 'light') : preference;
  return isShippedTheme(requestedTheme) ? requestedTheme : DEFAULT_THEME;
}

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_DEFAULT = 1;

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Stops refreshing the theme-color meta on OS changes; set while the preference is 'system'. */
let stopFollowingSystemScheme: (() => void) | null = null;

/** Copies the resolved --color-bg into `<meta name="theme-color">` so browser chrome matches. */
function syncThemeColorMeta(): void {
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColorMeta === null) return;
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-bg')
    .trim();
  // Before the stylesheets load there is nothing to copy, so the meta keeps its current value.
  if (background !== '') themeColorMeta.content = background;
}

function followSystemScheme(): void {
  if (stopFollowingSystemScheme !== null || typeof window.matchMedia !== 'function') return;
  const darkSchemeList = window.matchMedia(DARK_SCHEME_QUERY);
  darkSchemeList.addEventListener('change', syncThemeColorMeta);
  stopFollowingSystemScheme = () => {
    darkSchemeList.removeEventListener('change', syncThemeColorMeta);
  };
}

function stopFollowingSystem(): void {
  stopFollowingSystemScheme?.();
  stopFollowingSystemScheme = null;
}

/**
 * Puts a theme preference into effect. 'light' and 'dark' set `data-theme` on `<html>`; 'system'
 * removes it so tokens.css picks the theme (any `prefers-color-scheme` rules it has apply), and
 * keeps the theme-color meta in step when the OS setting changes. While dark is the only shipped
 * theme every preference shows the dark tokens; see resolveTheme.
 */
export function applyTheme(preference: ThemePreference): void {
  const rootElement = document.documentElement;
  switch (preference) {
    case 'system':
      delete rootElement.dataset['theme'];
      followSystemScheme();
      break;
    case 'light':
    case 'dark':
      rootElement.dataset['theme'] = preference;
      stopFollowingSystem();
      break;
  }
  syncThemeColorMeta();
}

/** Clamps a UI scale to the supported range; anything that is not a finite number becomes 1. */
export function clampUiScale(scale: number): number {
  if (!Number.isFinite(scale)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, scale));
}

/**
 * Sets the UI scale (0.8 to 1.5) as `--ui-scale` on `<html>`, which global.css multiplies into the
 * root font size so every rem-based size follows.
 *
 * This is the one sanctioned place where script writes a CSS variable. Everywhere else styling
 * stays in CSS Modules and tokens.
 */
export function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(clampUiScale(scale)));
}
