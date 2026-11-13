/**
 * Writing promotion history rows (DAY2-01): the weekly Monday rows, the new-game baseline and the
 * thinning of old weeks. The phase and the setup step are thin wrappers around these, so tests can
 * run them inside any transaction.
 *
 * Design: docs/design/office.md#history.
 */

import { addDays, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import {
  promotionSnapshotKey,
  type PromotionSnapshotGranularity,
} from '../../../model/entities/promotion-snapshot';
import type { PromotionStatus } from '../../../model/entities/promotion';
import type { GameTables } from '../../../model/tables';
import type { Tx } from '../../../model/tx';
import type { EngineTunables } from '../../tunables';
import { buildPromotionSnapshot, createSnapshotRoller } from './buildSnapshot';
import { planCompaction, type CompactionPlan } from './compaction';

/** Days in a week, for the compaction cutoff. */
const DAYS_PER_WEEK = 7;

/**
 * Writes one row per promotion whose status is in `statuses`, in id order, dated `date`. A row that
 * already exists for (promotion, date) is updated in place, granularity included, so a game that
 * starts on a Monday turns its baseline into that week's row instead of adding a second one.
 * Returns the promotions written for.
 */
export function writePromotionSnapshots(
  tx: Tx<GameTables>,
  date: GameDate,
  granularity: PromotionSnapshotGranularity,
  statuses: readonly PromotionStatus[],
  tunables: EngineTunables,
): PromotionId[] {
  const read = tx.view;
  const promotions = read.tables.promotions
    .values()
    .filter((promotion) => statuses.includes(promotion.status));
  if (promotions.length === 0) {
    return [];
  }
  const roller = createSnapshotRoller(read);
  const written: PromotionId[] = [];
  for (const promotion of promotions) {
    const columns = buildPromotionSnapshot(read, promotion.id, date, roller, tunables);
    const existing = read.tables.promotionSnapshots.lookupOne(
      'byPromotionDate',
      promotionSnapshotKey(promotion.id, date),
    );
    if (existing === undefined) {
      tx.create('promotionSnapshots', { ...columns, granularity });
    } else {
      tx.update('promotionSnapshots', existing.id, { ...columns, granularity });
    }
    written.push(promotion.id);
  }
  return written;
}

/** The first day still kept at full weekly detail on `date`. */
export function fullDetailCutoff(date: GameDate, tunables: EngineTunables): GameDate {
  return addDays(date, -DAYS_PER_WEEK * tunables.get('office.history.fullDetailWeeks'));
}

/** Thins every promotion's weekly rows dated before the cutoff to one row per month. */
export function compactPromotionSnapshots(
  tx: Tx<GameTables>,
  date: GameDate,
  tunables: EngineTunables,
): CompactionPlan {
  const plan = planCompaction(
    tx.view.tables.promotionSnapshots.values(),
    fullDetailCutoff(date, tunables),
  );
  for (const id of plan.toMonth) {
    tx.update('promotionSnapshots', id, { granularity: 'month' });
  }
  for (const id of plan.drop) {
    tx.delete('promotionSnapshots', id);
  }
  return plan;
}
