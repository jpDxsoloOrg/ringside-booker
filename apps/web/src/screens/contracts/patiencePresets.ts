/**
 * The Rules sheet's Worker patience presets: how unhappy a worker must be, and for how long,
 * before they ask to leave. Normal is the game's defaults (both overrides cleared).
 */

export const QUIT_THRESHOLD_KEY = 'contracts.quit.threshold';
export const QUIT_DAYS_KEY = 'contracts.quit.days';
export const EXPIRING_STOP_KEY = 'contracts.expiringSoon.stopSkip';
export const EXPIRING_MIN_PUSH_KEY = 'contracts.expiringSoon.minPush';
export const EXPIRING_SOON_DAYS_KEY = 'contracts.expiringSoon.days';
export const EXPIRING_WINDOW_KEY = 'contracts.expiring.windowDays';
export const AUTO_RENEW_KEY = 'contracts.autoRenewPlayer';
export const AUTO_RENEW_DAYS_KEY = 'contracts.autoRenewPlayerDays';

export type PatienceId = 'patient' | 'normal' | 'restless';

export interface PatiencePreset {
  readonly id: PatienceId;
  readonly label: string;
  /** One line of what it means. */
  readonly description: string;
  /** The morale at or below which the unhappy clock runs, or null for the game's default. */
  readonly threshold: number | null;
  /** Unhappy days before asking to leave, or null for the game's default. */
  readonly days: number | null;
}

export const PATIENCE_PRESETS: readonly PatiencePreset[] = [
  {
    id: 'patient',
    label: 'Patient',
    description: 'Only very unhappy workers (morale −60 or lower) ask to leave, after 30 days.',
    threshold: -60,
    days: 30,
  },
  {
    id: 'normal',
    label: 'Normal',
    description: 'The game’s usual rules: morale −40 or lower for 14 days.',
    threshold: null,
    days: null,
  },
  {
    id: 'restless',
    label: 'Restless',
    description: 'Workers ask to leave sooner: morale −15 or lower for 3 days.',
    threshold: -15,
    days: 3,
  },
];

/** What a preset's "Custom" stands for: the values match no preset. */
export const CUSTOM_PATIENCE = 'custom';

export interface PatienceValues {
  readonly threshold: number;
  readonly days: number;
  readonly thresholdOverridden: boolean;
  readonly daysOverridden: boolean;
}

/**
 * Which preset the current values match: Normal when neither is overridden, a preset when both
 * equal its numbers, else Custom.
 */
export function matchingPatience(values: PatienceValues): PatienceId | typeof CUSTOM_PATIENCE {
  if (!values.thresholdOverridden && !values.daysOverridden) return 'normal';
  const match = PATIENCE_PRESETS.find(
    (preset) =>
      preset.threshold !== null &&
      preset.threshold === values.threshold &&
      preset.days === values.days,
  );
  return match?.id ?? CUSTOM_PATIENCE;
}
