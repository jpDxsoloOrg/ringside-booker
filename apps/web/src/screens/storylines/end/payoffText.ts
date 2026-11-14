import { formatNumber } from '@/components/format';

/** "No payoff (needs 4 linked segments, has 1)": ending now pays nothing. */
export function notEligibleText(minSegments: number, countedSegments: number): string {
  return `No payoff (needs ${formatNumber(minSegments)} linked ${minSegments === 1 ? 'segment' : 'segments'}, has ${formatNumber(countedSegments)})`;
}

/** "No payoff (needs 4 linked segments, had 3)": an ended storyline that paid nothing. */
export function noPayoffRecordText(minSegments: number, countedSegments: number): string {
  return `No payoff (needs ${formatNumber(minSegments)} linked ${minSegments === 1 ? 'segment' : 'segments'}, had ${formatNumber(countedSegments)})`;
}

/** The label on the payoff strength's Why?. */
export const PAYOFF_STRENGTH_LABEL = 'Payoff strength';

/** What a payoff strength means for the members, in a few words. */
export function payoffStrengthWords(quality: number): string {
  if (quality >= 0.5) return 'a big lift for everyone in it';
  if (quality > 0) return 'a small lift for everyone in it';
  if (quality === 0) return 'nothing either way';
  if (quality > -0.5) return 'the story fell flat: a small drop';
  return 'the story went cold: a real drop';
}

/** "Segments still booked for Test Weekly will no longer count". */
export function stillBookedText(showName: string): string {
  return `Segments still booked for ${showName} will no longer count`;
}

/** The ending panel's line for a storyline that ended before payoffs existed (an old save). */
export const OLD_SAVE_PAYOFF_TEXT = 'Ended before storyline payoffs, so it paid nothing';

export const FINALE_PLAYED_TEXT = 'Its finale was played, so a hot story pays off more';
