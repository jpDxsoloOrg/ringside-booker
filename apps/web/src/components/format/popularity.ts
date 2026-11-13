/**
 * Popularity as every screen shows it: one decimal at most, `70.3`, `44`, `+0.2`.
 *
 * Popularity (a promotion's or a worker's, 0 to 100) is stored to two decimals, but the second
 * one is noise to a player, and two screens rounding it differently made the same number read
 * `70.3` on the Office and `70.29` elsewhere. Every popularity value and change goes through these
 * helpers, and a trace step in `points` reads the same way (see `formatTraceNumber`), so the
 * number in a Why? panel matches the card that opened it.
 *
 * Use them for any new popularity text (the fan base sheet, a results line, a tooltip); do not
 * pick decimals by hand.
 */
import { formatNumber, formatSigned } from './format';

/** Decimals popularity is shown to, values and changes alike. */
export const POPULARITY_DECIMALS = 1;

const POPULARITY_DIGITS = { maximumFractionDigits: POPULARITY_DECIMALS } as const;
const DECIMAL_SCALE = 10 ** POPULARITY_DECIMALS;

/** A popularity value: `70.3`, or `44` when the decimal is 0. */
export function formatPopularity(value: number): string {
  return formatNumber(value, POPULARITY_DIGITS);
}

/** A popularity change with its sign: `+0.2`, `−1.5`, or `0` when it rounds away. */
export function formatPopularityChange(change: number): string {
  return formatSigned(change, POPULARITY_DIGITS);
}

/**
 * Popularity rounded to the decimals it is shown with, as a number, for a place that takes a
 * number rather than text (a stat bar, a sort key that should match what is read).
 */
export function roundPopularity(value: number): number {
  return Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE;
}
