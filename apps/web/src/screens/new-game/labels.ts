/**
 * Words for the engine's codes in the wizard. The codes themselves (styles, setting options) come
 * from the engine, so a new one gets a readable label without a change here.
 */

import type { NewGameSettingGroup, Weekday } from '@ringside/engine';

/** `highFlying` → `High flying`, `low` → `Low`: a camelCase code as a sentence-case label. */
export function codeLabel(code: string): string {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words === '' ? code : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The weekdays as the engine numbers them: 0 is Monday. */
export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  0: 'Monday',
  1: 'Tuesday',
  2: 'Wednesday',
  3: 'Thursday',
  4: 'Friday',
  5: 'Saturday',
  6: 'Sunday',
};

/** Every weekday, Monday first. */
export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The heading over each group of new-game settings. */
export const SETTING_GROUP_LABELS: Readonly<Record<NewGameSettingGroup, string>> = {
  world: 'World',
  difficulty: 'Difficulty',
  advanced: 'Advanced settings',
};

/** A setting's value in words: On/Off for a switch, the option's label for a choice. */
export function settingValueLabel(value: boolean | string): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  return codeLabel(value);
}
