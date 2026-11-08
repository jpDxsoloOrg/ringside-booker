import { z } from 'zod';
import type { MoneyStyle } from '@/components/format/format';
import { DEFAULT_THEME, UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN } from '@/styles/theme';
import type { ThemePreference } from '@/styles/theme';

/**
 * The viewer's preferences: how this browser shows the game. They describe the device, not the
 * game world, so they live in localStorage and never in a save file. Moving a save from a desktop
 * to a phone keeps the phone's own scale and motion settings.
 *
 * The object carries a version so later preferences can arrive with a migration instead of a reset.
 */

export const SETTINGS_VERSION = 1;

export const THEME_PREFERENCES = [
  'system',
  'light',
  'dark',
] as const satisfies readonly ThemePreference[];

/**
 * `system` follows the OS setting; `on` always reduces motion; `off` keeps full motion even when
 * the OS asks for less.
 */
export const REDUCED_MOTION_PREFERENCES = ['system', 'on', 'off'] as const;
export type ReducedMotionPreference = (typeof REDUCED_MOTION_PREFERENCES)[number];

export const MONEY_STYLES = ['compact', 'full'] as const satisfies readonly MoneyStyle[];

/** The UI scale moves in 5% steps between 80% and 150%. */
export const UI_SCALE_STEP = 0.05;

const PERCENT = 100;
const SCALE_STEP_PERCENT = Math.round(UI_SCALE_STEP * PERCENT);

/**
 * Snaps a scale to the nearest 5% step and rounds away float noise, so `1.23` reads as `1.25` and
 * `0.1 + 0.2`-style artefacts never reach the screen or storage.
 */
export function snapUiScale(scale: number): number {
  const percent = Math.round(scale * PERCENT);
  return (Math.round(percent / SCALE_STEP_PERCENT) * SCALE_STEP_PERCENT) / PERCENT;
}

/** A scale in range, snapped to the step. Out-of-range values fail rather than clamp. */
const uiScaleSchema = z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX).transform(snapUiScale);

const settingFieldSchemas = {
  theme: z.enum(THEME_PREFERENCES),
  uiScale: uiScaleSchema,
  reducedMotion: z.enum(REDUCED_MOTION_PREFERENCES),
  moneyStyle: z.enum(MONEY_STYLES),
} as const;

export const settingsV1Schema = z.object({
  version: z.literal(SETTINGS_VERSION),
  ...settingFieldSchemas,
});

export type SettingsV1 = z.infer<typeof settingsV1Schema>;

/** The preferences a player can change: everything but the version. */
export type SettingsPatch = Partial<Omit<SettingsV1, 'version'>>;

export const DEFAULT_SETTINGS: SettingsV1 = {
  version: SETTINGS_VERSION,
  theme: DEFAULT_THEME,
  uiScale: UI_SCALE_DEFAULT,
  reducedMotion: 'system',
  moneyStyle: 'compact',
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks each field on its own and copies the valid ones over `base`. Fields that are missing or
 * invalid keep `base`'s value; keys the schema does not know are dropped.
 */
function mergeValidFields(
  base: SettingsV1,
  candidate: Readonly<Record<string, unknown>>,
): SettingsV1 {
  const theme = settingFieldSchemas.theme.safeParse(candidate['theme']);
  const uiScale = settingFieldSchemas.uiScale.safeParse(candidate['uiScale']);
  const reducedMotion = settingFieldSchemas.reducedMotion.safeParse(candidate['reducedMotion']);
  const moneyStyle = settingFieldSchemas.moneyStyle.safeParse(candidate['moneyStyle']);
  return {
    version: SETTINGS_VERSION,
    theme: theme.success ? theme.data : base.theme,
    uiScale: uiScale.success ? uiScale.data : base.uiScale,
    reducedMotion: reducedMotion.success ? reducedMotion.data : base.reducedMotion,
    moneyStyle: moneyStyle.success ? moneyStyle.data : base.moneyStyle,
  };
}

/**
 * Reads stored settings, whatever shape they arrive in. Anything that is not an object gives the
 * defaults; an object keeps each valid field and defaults the rest, so one hand-edited value
 * never resets the others or breaks the app.
 */
export function parseSettings(input: unknown): SettingsV1 {
  if (!isRecord(input)) return DEFAULT_SETTINGS;
  return mergeValidFields(DEFAULT_SETTINGS, input);
}

/** Applies a change on top of the current settings. An invalid field in the change is ignored. */
export function mergeSettings(current: SettingsV1, patch: SettingsPatch): SettingsV1 {
  return mergeValidFields(current, patch);
}
