/**
 * Season length at new game (design decision D-08).
 *
 * The player picks a preset or a custom number of weeks. Every preset is a whole number of weeks,
 * so weekly shows fall evenly into seasons: "1 month" is 28 days and "12 months" is 364. Aging,
 * contracts and injuries stay on the real calendar; only the competitive rhythm follows the season.
 *
 * See docs/design/new-game.md#season-length-and-season-1.
 */

import { InvalidArgumentError } from '../../core/errors';
import type { Reason } from '../../core/api/result';
import { SEASON_LENGTH_DAYS_MAX, SEASON_LENGTH_DAYS_MIN } from '../../model/world-meta';

export const SEASON_PRESET_KEYS = ['1m', '3m', '6m', '12m'] as const;
export type SeasonPresetKey = (typeof SEASON_PRESET_KEYS)[number];

export interface SeasonPreset {
  key: SeasonPresetKey;
  label: string;
  lengthDays: number;
}

export const SEASON_PRESETS: readonly Readonly<SeasonPreset>[] = Object.freeze([
  Object.freeze({ key: '1m', label: '1 month', lengthDays: 28 }),
  Object.freeze({ key: '3m', label: '3 months', lengthDays: 91 }),
  Object.freeze({ key: '6m', label: '6 months', lengthDays: 182 }),
  Object.freeze({ key: '12m', label: '12 months', lengthDays: 364 }),
] satisfies SeasonPreset[]);

/** The preset the wizard selects first. */
export const DEFAULT_SEASON_PRESET: SeasonPresetKey = '12m';

/** Shortest and longest custom season, in weeks. */
export const CUSTOM_SEASON_WEEKS_MIN = 4;
export const CUSTOM_SEASON_WEEKS_MAX = 104;

const DAYS_PER_WEEK = 7;

/** What the player chose: a preset, or a custom number of whole weeks. */
export type SeasonLengthChoice = { preset: SeasonPresetKey } | { customWeeks: number };

/** Why a custom week count is refused, or an empty list when it is fine. */
export function seasonLengthReasons(choice: SeasonLengthChoice): Reason[] {
  if ('preset' in choice) {
    return [];
  }
  const weeks = choice.customWeeks;
  if (
    !Number.isInteger(weeks) ||
    weeks < CUSTOM_SEASON_WEEKS_MIN ||
    weeks > CUSTOM_SEASON_WEEKS_MAX
  ) {
    return [
      {
        code: 'seasonLengthOutOfRange',
        message: `A custom season is a whole number of weeks from ${String(CUSTOM_SEASON_WEEKS_MIN)} to ${String(CUSTOM_SEASON_WEEKS_MAX)}.`,
        field: 'seasonLength.customWeeks',
      },
    ];
  }
  return [];
}

/**
 * The season length in days: the preset's length, or `customWeeks × 7`. Always inside
 * `SEASON_LENGTH_DAYS_MIN`–`SEASON_LENGTH_DAYS_MAX` (28–730).
 *
 * @throws InvalidArgumentError for a custom week count outside 4–104 or not a whole number.
 */
export function resolveSeasonLength(choice: SeasonLengthChoice): number {
  if ('preset' in choice) {
    const preset = SEASON_PRESETS.find((candidate) => candidate.key === choice.preset);
    if (preset === undefined) {
      throw new InvalidArgumentError(
        'resolveSeasonLength',
        'choice.preset',
        choice.preset,
        `one of ${SEASON_PRESET_KEYS.join(', ')}`,
      );
    }
    return preset.lengthDays;
  }
  if (seasonLengthReasons(choice).length > 0) {
    throw new InvalidArgumentError(
      'resolveSeasonLength',
      'choice.customWeeks',
      choice.customWeeks,
      `a whole number from ${String(CUSTOM_SEASON_WEEKS_MIN)} to ${String(CUSTOM_SEASON_WEEKS_MAX)}`,
    );
  }
  const days = choice.customWeeks * DAYS_PER_WEEK;
  // 4-104 weeks is 28-728 days, inside the stored range; this guards a change to either limit.
  if (days < SEASON_LENGTH_DAYS_MIN || days > SEASON_LENGTH_DAYS_MAX) {
    throw new InvalidArgumentError(
      'resolveSeasonLength',
      'choice.customWeeks',
      choice.customWeeks,
      `a week count whose days fit ${String(SEASON_LENGTH_DAYS_MIN)}-${String(SEASON_LENGTH_DAYS_MAX)}`,
    );
  }
  return days;
}
