/**
 * Reading the promotion history back for the Office (DAY2-03): the row a KPI's delta compares
 * with, and the points of its sparkline.
 *
 * Design: docs/design/office.md#kpis-and-deltas.
 */

import { addDays, compareDates, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import type { PromotionSnapshot } from '../../../model/entities/promotion-snapshot';
import type { GameWorldView } from '../../../model/tables';
import { officeMetric } from './metrics';

/** Days in a week, for the trend window. */
const DAYS_PER_WEEK = 7;

/** A sparkline: dates and values, oldest first. */
export interface TrendSeries {
  dates: GameDate[];
  values: number[];
}

/** Every history row of `promotionId`, oldest first. */
export function promotionHistory(
  read: GameWorldView,
  promotionId: PromotionId,
): PromotionSnapshot[] {
  return [...read.tables.promotionSnapshots.lookup('byPromotion', promotionId)].sort(
    (left, right) => compareDates(left.date, right.date),
  );
}

/**
 * The row a delta compares with: the latest row dated on or before `today − lookbackDays`, or
 * null when there is none yet (the caller shows no delta, never a fake 0).
 */
export function previousSnapshot(
  read: GameWorldView,
  promotionId: PromotionId,
  today: GameDate,
  lookbackDays: number,
): PromotionSnapshot | null {
  const latestAllowed = addDays(today, -lookbackDays);
  let found: PromotionSnapshot | null = null;
  for (const row of promotionHistory(read, promotionId)) {
    if (compareDates(row.date, latestAllowed) > 0) {
      break;
    }
    found = row;
  }
  return found;
}

/**
 * The sparkline of `metric` (a built-in column or registered field key): the rows dated after
 * `today − 7 × weeks` and before today, oldest first, then `live` dated today, so the line always
 * ends at "now". A row without the metric (a field registered later, nobody to average) is skipped,
 * not drawn as 0; so is a null `live` value. An unknown metric gives an empty series.
 */
export function trendSeries(
  read: GameWorldView,
  promotionId: PromotionId,
  metric: string,
  today: GameDate,
  weeks: number,
  live: number | null,
): TrendSeries {
  const series: TrendSeries = { dates: [], values: [] };
  const reader = officeMetric(metric);
  if (reader === undefined) {
    return series;
  }
  const after = addDays(today, -DAYS_PER_WEEK * weeks);
  for (const row of promotionHistory(read, promotionId)) {
    if (compareDates(row.date, after) <= 0 || compareDates(row.date, today) >= 0) {
      continue;
    }
    const value = reader.fromRow(row);
    if (value !== null) {
      series.dates.push(row.date);
      series.values.push(value);
    }
  }
  if (live !== null) {
    series.dates.push(today);
    series.values.push(live);
  }
  return series;
}
