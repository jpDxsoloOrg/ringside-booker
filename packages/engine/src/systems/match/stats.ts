/**
 * Summary statistics for the Match lab's batch preview (`match.previewBatch`): mean, spread,
 * percentiles, a score histogram and a quarter-star distribution. Pure functions over numbers.
 *
 * Design: docs/design/match-rating.md#previews.
 */

/** Mean, population standard deviation, extremes and three percentiles, each rounded to 0.1. */
export interface Stats {
  mean: number;
  /** Population standard deviation (divides by n, not n - 1). */
  sd: number;
  min: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
}

/** One bin of a histogram: `from` included, `to` excluded except on the last bin. */
export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** How many runs came out at one quarter-star rating. */
export interface QuarterCount {
  stars: number;
  count: number;
}

/** Score histogram: 20 bins of 5 points from 0 to 100, the last one closed (95–100). */
export const SCORE_HISTOGRAM_BINS = 20;
export const SCORE_HISTOGRAM_WIDTH = 5;

/** The star range a quarter-star distribution always covers, even when no run reached it. */
export const QUARTER_COUNT_MAX_STARS = 5;

/** Rounds to one decimal place. */
export function roundTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  // Keep -0 out of the JSON.
  return rounded === 0 ? 0 : rounded;
}

function requireValues(values: readonly number[], what: string): void {
  if (values.length === 0) {
    throw new RangeError(`${what} needs at least one value`);
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${what} needs finite numbers; got ${String(value)}`);
    }
  }
}

/** A numeric (never lexical) ascending copy. */
export function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

/**
 * The `fraction` quantile (0..1) of an ascending list, interpolating linearly between the two
 * nearest ranks (`(n - 1) × fraction`), so p50 of an even count is the mean of the middle two.
 */
export function quantileOfSorted(sorted: readonly number[], fraction: number): number {
  requireValues(sorted, 'quantileOfSorted');
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * The summary of `values`, every field rounded to 0.1.
 *
 * @throws RangeError for an empty list or a value that is not a finite number.
 */
export function statsOf(values: readonly number[]): Stats {
  requireValues(values, 'statsOf');
  const sorted = sortedNumbers(values);
  const count = sorted.length;
  const mean = sorted.reduce((total, value) => total + value, 0) / count;
  const variance = sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
  return {
    mean: roundTenth(mean),
    sd: roundTenth(Math.sqrt(variance)),
    min: roundTenth(sorted[0] ?? 0),
    p10: roundTenth(quantileOfSorted(sorted, 0.1)),
    p50: roundTenth(quantileOfSorted(sorted, 0.5)),
    p90: roundTenth(quantileOfSorted(sorted, 0.9)),
    max: roundTenth(sorted[count - 1] ?? 0),
  };
}

/**
 * Scores (0–100) counted into 20 bins of 5 points: 0–5, 5–10, ... 95–100. Each bin holds `from`
 * up to but not including `to`, except the last, which also holds 100. Scores outside 0–100 are
 * counted in the nearest end bin.
 *
 * @throws RangeError for an empty list or a value that is not a finite number.
 */
export function scoreHistogram(scores: readonly number[]): HistogramBin[] {
  requireValues(scores, 'scoreHistogram');
  const bins: HistogramBin[] = [];
  for (let index = 0; index < SCORE_HISTOGRAM_BINS; index += 1) {
    bins.push({
      from: index * SCORE_HISTOGRAM_WIDTH,
      to: (index + 1) * SCORE_HISTOGRAM_WIDTH,
      count: 0,
    });
  }
  for (const score of scores) {
    const index = Math.min(
      SCORE_HISTOGRAM_BINS - 1,
      Math.max(0, Math.floor(score / SCORE_HISTOGRAM_WIDTH)),
    );
    const bin = bins[index];
    if (bin !== undefined) {
      bin.count += 1;
    }
  }
  return bins;
}

/**
 * How many runs landed on each quarter star, from 0 up to 5 stars (or the highest rating seen,
 * when a raised cap let one go past 5), ascending. Ratings are rounded to the nearest quarter
 * first, so a value already in quarter steps is counted exactly.
 *
 * @throws RangeError for an empty list or a value that is not a finite number.
 */
export function quarterCounts(stars: readonly number[]): QuarterCount[] {
  requireValues(stars, 'quarterCounts');
  const quarters = stars.map((value) => Math.max(0, Math.round(value * 4)));
  const top = Math.max(QUARTER_COUNT_MAX_STARS * 4, ...quarters);
  const counts = new Array<number>(top + 1).fill(0);
  for (const quarter of quarters) {
    counts[quarter] = (counts[quarter] ?? 0) + 1;
  }
  return counts.map((count, quarter) => ({ stars: quarter / 4, count }));
}
