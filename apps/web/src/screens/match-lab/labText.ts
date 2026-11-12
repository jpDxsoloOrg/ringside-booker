/**
 * The Match lab's wording, kept apart from the components so it can be tested on its own. Nothing
 * here says how long a segment runs (D-10): slot role, duration class and weight are the only
 * "how long" words on the screen.
 */
import type { AngleTypeOption, CountRange, MatchTypeOption, Stats } from '@ringside/engine';
import { formatNumber, MINUS_SIGN } from '@/components/format';

/** "Side 2" for the 0-based side 1. */
export function sideLabel(side: number): string {
  return `Side ${String(side + 1)}`;
}

/** "1", or "1 to 3". */
function rangeText(range: CountRange): string {
  return range.min === range.max
    ? String(range.min)
    : `${String(range.min)} to ${String(range.max)}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** What a match type takes: "2 sides, 1 each", "2 to 30 sides, 1 each", "2 sides, 1 to 3 each". */
export function matchLimitsText(matchType: MatchTypeOption): string {
  const sides = `${rangeText(matchType.sides)} ${plural(matchType.sides.max, 'side', 'sides')}`;
  const each = `${rangeText(matchType.sideSize)} each`;
  return matchType.equalSides && matchType.sideSize.min !== matchType.sideSize.max
    ? `${sides}, ${each}, equal sides`
    : `${sides}, ${each}`;
}

/** What a talking segment takes: "1 to 4 speakers". */
export function angleLimitsText(angleType: AngleTypeOption): string {
  return `${rangeText(angleType.speakers)} ${plural(angleType.speakers.max, 'speaker', 'speakers')}`;
}

/** A slot weight as the chips show it: "×1.00", "×1.75". */
export function weightText(weight: number): string {
  return `×${weight.toFixed(2)}`;
}

/** "Seed 3". */
export function seedText(seed: number): string {
  return `Seed ${String(seed)}`;
}

/** A batch statistic: whole numbers stay whole, anything else gets one decimal. */
export function statNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/** "Mean 63.4 · spread ±5.1 · range 49–77 · middle 80% 57–70". */
export function statsSummary(stats: Stats): string {
  return [
    `Mean ${statNumber(stats.mean)}`,
    `spread ±${statNumber(stats.sd)}`,
    `range ${statNumber(stats.min)}–${statNumber(stats.max)}`,
    `middle 80% ${statNumber(stats.p10)}–${statNumber(stats.p90)}`,
  ].join(' · ');
}

/** "6 below expectation", "4 above expectation", "right on expectation". */
export function expectationGapText(got: number, expected: number): string {
  const gap = Math.round(got - expected);
  if (gap === 0) return 'right on expectation';
  return `${String(Math.abs(gap))} ${gap < 0 ? 'below' : 'above'} expectation`;
}

/**
 * A stamina penalty chip: "Passed" with no penalty, "Failed −6" with one. A penalty under a point
 * keeps a decimal ("Failed −0.4"), so a small miss never reads as "Passed" on a failed chip.
 */
export function staminaText(penalty: number): string {
  const points = Math.abs(penalty);
  if (points === 0) return 'Passed';
  const shown = formatNumber(points, { maximumFractionDigits: points < 1 ? 2 : 0 });
  return `Failed ${MINUS_SIGN}${shown}`;
}

/** A star value as text: "3.75 stars", "1 star". */
export function starsText(stars: number): string {
  return `${formatNumber(stars, { maximumFractionDigits: 2 })} ${stars === 1 ? 'star' : 'stars'}`;
}
