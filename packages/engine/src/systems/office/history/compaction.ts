/**
 * Thinning old promotion history (DAY2-01).
 *
 * Weekly rows dated before the cutoff (`office.history.fullDetailWeeks` weeks back) are grouped by
 * promotion and calendar month. In each group the latest row is kept and becomes the month's row
 * (`month`); the others are dropped. Rows that are already `month` rows count towards their month
 * like weekly rows do, so running the plan again changes nothing. Baseline rows are never touched.
 *
 * Pure, so it is tested without a world. See docs/design/office.md#retention.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { PromotionSnapshotId } from '../../../core/ids';
import type { PromotionSnapshot } from '../../../model/entities/promotion-snapshot';
import { compareIds } from '../../../model/table';
import type { DeepReadonly } from '../../../model/world';

/** The rows the plan reads. */
export type CompactionRow = Pick<
  DeepReadonly<PromotionSnapshot>,
  'id' | 'promotionId' | 'date' | 'granularity'
>;

/** What to do with each row before the cutoff. Every list is in id order. */
export interface CompactionPlan {
  /** Rows that stay as they are: a month's kept row that is already `month`, or a baseline. */
  keep: PromotionSnapshotId[];
  /** Weekly rows kept as their month's row: set them to `month`. */
  toMonth: PromotionSnapshotId[];
  /** Rows to delete. */
  drop: PromotionSnapshotId[];
}

/** Latest date first, then the higher id. */
function latestFirst(left: CompactionRow, right: CompactionRow): number {
  return compareDates(right.date, left.date) || compareIds(right.id, left.id);
}

/**
 * The plan for `rows` (any promotions, any order) with weekly detail kept from `cutoff` on. Rows
 * dated on or after the cutoff are left out of the plan entirely.
 */
export function planCompaction(rows: readonly CompactionRow[], cutoff: GameDate): CompactionPlan {
  const keep: PromotionSnapshotId[] = [];
  const toMonth: PromotionSnapshotId[] = [];
  const drop: PromotionSnapshotId[] = [];
  const groups = new Map<string, CompactionRow[]>();
  for (const row of rows) {
    if (compareDates(row.date, cutoff) >= 0) {
      continue;
    }
    if (row.granularity === 'baseline') {
      keep.push(row.id);
      continue;
    }
    const key = `${row.promotionId}|${row.date.slice(0, 7)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }
  for (const group of groups.values()) {
    const [latest, ...older] = [...group].sort(latestFirst);
    if (latest === undefined) {
      continue;
    }
    (latest.granularity === 'month' ? keep : toMonth).push(latest.id);
    for (const row of older) {
      drop.push(row.id);
    }
  }
  return {
    keep: keep.sort(compareIds),
    toMonth: toMonth.sort(compareIds),
    drop: drop.sort(compareIds),
  };
}
