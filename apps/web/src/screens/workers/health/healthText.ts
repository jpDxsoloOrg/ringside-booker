/**
 * The Health tab's words (WRK6-05): body parts, severities, fatigue bands, injury sources and the
 * "Out until" line. Shared by the tab, the injury card and the roster's injury screens (WRK6-06).
 */
import type {
  BodyPart,
  FatigueBand,
  GameDate,
  InjurySeverity,
  InjurySource,
} from '@ringside/engine';
import { formatGameDate } from '@/components/format';
import {
  INJURY_CARD_BODY_PARTS,
  INJURY_CARD_SEVERITIES,
  INJURY_CARD_SOURCES,
} from '@/components/InjuryCard';
import type { Tone } from '@/components/tone';

/** Head, Neck, Back, Arms, Torso, Legs: the injury card's words, so both read the same. */
export const BODY_PART_LABELS: Readonly<Record<BodyPart, string>> = INJURY_CARD_BODY_PARTS;

/** The badge colour for each severity. The word is always shown too, so it is never colour alone. */
export const SEVERITY_TONES: Readonly<Record<InjurySeverity, Tone>> = {
  minor: INJURY_CARD_SEVERITIES.minor.tone,
  moderate: INJURY_CARD_SEVERITIES.moderate.tone,
  severe: INJURY_CARD_SEVERITIES.severe.tone,
};

/** Minor, Moderate, Severe. */
export const SEVERITY_LABELS: Readonly<Record<InjurySeverity, string>> = {
  minor: INJURY_CARD_SEVERITIES.minor.label,
  moderate: INJURY_CARD_SEVERITIES.moderate.label,
  severe: INJURY_CARD_SEVERITIES.severe.label,
};

export const FATIGUE_BAND_LABELS: Readonly<Record<FatigueBand, string>> = {
  fresh: 'Fresh',
  tired: 'Tired',
  weary: 'Weary',
  spent: 'Spent',
};

/** Off-screen, In a match. */
export const INJURY_SOURCE_LABELS: Readonly<Record<InjurySource, string>> = INJURY_CARD_SOURCES;

/** "1 day left", "23 days left", or "Back today" on the day itself. */
export function daysLeftText(daysRemaining: number): string {
  if (daysRemaining <= 0) return 'Back today';
  return daysRemaining === 1 ? '1 day left' : `${String(daysRemaining)} days left`;
}

/** "1 day" or "23 days". */
export function daysText(days: number): string {
  return days === 1 ? '1 day' : `${String(days)} days`;
}

/** "Out until Mar 14, 2027 · 23 days left". */
export function outUntilText(expectedReturn: GameDate, daysRemaining: number): string {
  return `Out until ${formatGameDate(expectedReturn)} · ${daysLeftText(daysRemaining)}`;
}

/** "Yes" or "No", for the injury card's Can work angles row. */
export function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}
