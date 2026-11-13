/**
 * The office system's day phase: every Monday, one history row per open promotion, then the
 * thinning of weeks older than `office.history.fullDetailWeeks`.
 *
 * It runs in the `periodic` group, after the day's shows, settlement, growth and money, so a
 * Monday row already includes that Monday's show and payroll. No random numbers are drawn and the
 * rows store no traces: rows are facts, and the Office rebuilds a live value's Why? when it reads
 * it. The phase does re-record each active promotion's headline popularity Why? (DAY2-02), one
 * replaced entry per promotion.
 * See docs/design/office.md#history and docs/design/day-pipeline.md.
 */

import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { compactPromotionSnapshots, writePromotionSnapshots } from './history/writeSnapshots';
import { recordAllHeadlinePopularity } from './popularity';

export const WEEKLY_SNAPSHOT_PHASE_ID = 'office.weeklySnapshot';
/** The phase's slot in the `periodic` group: after momentum drift (30), before the prune (40). */
export const WEEKLY_SNAPSHOT_PHASE_ORDER = 34;

export const weeklySnapshotPhase: PhaseDefinition = definePhase({
  id: WEEKLY_SNAPSHOT_PHASE_ID,
  group: 'periodic',
  order: WEEKLY_SNAPSHOT_PHASE_ORDER,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    // Closed promotions stop getting rows but keep the history they have.
    const promotionIds = writePromotionSnapshots(
      ctx.tx,
      ctx.date,
      'week',
      ['active', 'dormant'],
      ctx.tunables,
    );
    const plan = compactPromotionSnapshots(ctx.tx, ctx.date, ctx.tunables);
    ctx.log(
      `Wrote ${String(promotionIds.length)} promotion snapshot(s); thinned ${String(plan.toMonth.length)} to months and dropped ${String(plan.drop.length)}`,
    );
    if (promotionIds.length > 0) {
      ctx.publish('office.snapshotTaken', { date: ctx.date, promotionIds });
    }
    // Re-record the headline popularity Why? (DAY2-02): it also repairs a trace dropped by
    // retention, and dates the Why? to this week.
    recordAllHeadlinePopularity(ctx);
  },
});

export const officePhases: readonly PhaseDefinition[] = [weeklySnapshotPhase];
