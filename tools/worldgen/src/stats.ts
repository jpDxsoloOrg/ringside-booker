/** Small numeric helpers for the roster build: whole counts from shares, ranks and correlation. */

/**
 * Splits `total` into whole counts in proportion to `shares` (largest remainder method). The counts
 * always add up to `total`; a tie on the remainder goes to the key listed first.
 */
export function countsFromShares<Key extends string>(
  shares: Readonly<Record<Key, number>>,
  keys: readonly Key[],
  total: number,
): Map<Key, number> {
  const shareTotal = keys.reduce((sum, key) => sum + shares[key], 0);
  const exact = keys.map((key) => (shareTotal === 0 ? 0 : (shares[key] / shareTotal) * total));
  const counts = exact.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const byRemainder = keys
    .map((_, index) => index)
    .sort((first, second) => {
      const remainderOf = (index: number): number => (exact[index] ?? 0) - (counts[index] ?? 0);
      const difference = remainderOf(second) - remainderOf(first);
      return difference !== 0 ? difference : first - second;
    });
  for (const index of byRemainder) {
    if (remaining <= 0) {
      break;
    }
    counts[index] = (counts[index] ?? 0) + 1;
    remaining -= 1;
  }
  return new Map(keys.map((key, index) => [key, counts[index] ?? 0]));
}

/** Ranks with ties sharing their average rank (1-based), as Spearman's coefficient needs. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.value === order[start]?.value) {
      end += 1;
    }
    const rank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i++) {
      const entry = order[i];
      if (entry !== undefined) {
        ranks[entry.index] = rank;
      }
    }
    start = end + 1;
  }
  return ranks;
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const count = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < count; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  return varianceX === 0 || varianceY === 0 ? 0 : covariance / Math.sqrt(varianceX * varianceY);
}

/** Spearman's rank correlation, with ties given their average rank. 0 when either side is flat. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) {
    return 0;
  }
  return pearson(averageRanks(xs), averageRanks(ys));
}

/** A number with two digits at least: 1 → "01". */
export function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** Rounds to one decimal, the precision regional popularity is stored at. */
export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Compares strings by code unit, so sorting never depends on the locale. */
export function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
