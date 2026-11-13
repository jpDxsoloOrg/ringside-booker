// Thinning old promotion history (DAY2-01). Design: docs/design/office.md#retention
import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../../src/core/date';
import type { PromotionId, PromotionSnapshotId } from '../../../../src/core/ids';
import type { PromotionSnapshotGranularity } from '../../../../src/model/entities/promotion-snapshot';
import { planCompaction, type CompactionRow } from '../../../../src/systems/office';
import { testId } from '../../../support/ids';

const FIRST_MONDAY = parseGameDate('2024-01-01');
const WEEKS = 104;
const FULL_DETAIL_WEEKS = 52;

let serial = 0;
function row(
  promotionId: PromotionId,
  date: GameDate,
  granularity: PromotionSnapshotGranularity = 'week',
): CompactionRow {
  serial += 1;
  return { id: testId('promotionSnapshot', serial), promotionId, date, granularity };
}

/** Two years of Mondays for two promotions, each with a baseline row on the first day. */
function twoYears(): { rows: CompactionRow[]; lastMonday: GameDate } {
  serial = 0;
  const rows: CompactionRow[] = [];
  for (const promotionId of [testId('promotion', 1), testId('promotion', 2)]) {
    rows.push(row(promotionId, addDays(FIRST_MONDAY, -2), 'baseline'));
    for (let week = 0; week < WEEKS; week += 1) {
      rows.push(row(promotionId, addDays(FIRST_MONDAY, 7 * week)));
    }
  }
  return { rows, lastMonday: addDays(FIRST_MONDAY, 7 * (WEEKS - 1)) };
}

/** The rows left after carrying out a plan. */
function apply(rows: readonly CompactionRow[], cutoff: GameDate): CompactionRow[] {
  const plan = planCompaction(rows, cutoff);
  const dropped = new Set<PromotionSnapshotId>(plan.drop);
  const toMonth = new Set<PromotionSnapshotId>(plan.toMonth);
  return rows
    .filter((candidate) => !dropped.has(candidate.id))
    .map((candidate) =>
      toMonth.has(candidate.id) ? { ...candidate, granularity: 'month' as const } : candidate,
    );
}

describe('planCompaction', () => {
  it('thins two years to the last 52 weeks in full plus one row per older month', () => {
    const { rows, lastMonday } = twoYears();
    const cutoff = addDays(lastMonday, -7 * FULL_DETAIL_WEEKS);
    const left = apply(rows, cutoff);
    const promotionOne = left.filter((candidate) => candidate.promotionId === testId('promotion'));

    const weeks = promotionOne.filter((candidate) => candidate.granularity === 'week');
    // The cutoff Monday itself and the 52 after it.
    expect(weeks).toHaveLength(FULL_DETAIL_WEEKS + 1);
    const months = promotionOne.filter((candidate) => candidate.granularity === 'month');
    const olderMonths = new Set(
      rows
        .filter((candidate) => candidate.granularity === 'week' && candidate.date < cutoff)
        .map((candidate) => candidate.date.slice(0, 7)),
    );
    expect(months.map((candidate) => candidate.date.slice(0, 7))).toEqual([...olderMonths]);
    // Each month keeps its last Monday.
    expect(months[0]?.date).toBe('2024-01-29');
    expect(promotionOne.filter((candidate) => candidate.granularity === 'baseline')).toHaveLength(
      1,
    );
    expect(left).toHaveLength(2 * (1 + FULL_DETAIL_WEEKS + 1 + olderMonths.size));
  });

  it('never drops or changes a baseline row', () => {
    const { rows, lastMonday } = twoYears();
    const plan = planCompaction(rows, addDays(lastMonday, 7));
    const baselines = rows
      .filter((candidate) => candidate.granularity === 'baseline')
      .map((candidate) => candidate.id);
    expect(plan.keep).toEqual(expect.arrayContaining(baselines));
    for (const id of baselines) {
      expect(plan.drop).not.toContain(id);
      expect(plan.toMonth).not.toContain(id);
    }
  });

  it('is idempotent: a second plan over the result changes nothing', () => {
    const { rows, lastMonday } = twoYears();
    const cutoff = addDays(lastMonday, -7 * FULL_DETAIL_WEEKS);
    const once = apply(rows, cutoff);
    const again = planCompaction(once, cutoff);
    expect(again.toMonth).toEqual([]);
    expect(again.drop).toEqual([]);
    expect(apply(once, cutoff)).toEqual(once);
  });

  it('folds a newer week into a month that already has a month row', () => {
    serial = 0;
    const promotionId = testId('promotion');
    const month = row(promotionId, parseGameDate('2025-03-03'), 'month');
    const later = row(promotionId, parseGameDate('2025-03-10'));
    const plan = planCompaction([later, month], parseGameDate('2025-03-17'));
    expect(plan).toEqual({ keep: [], toMonth: [later.id], drop: [month.id] });
  });

  it('leaves rows on or after the cutoff out of the plan', () => {
    serial = 0;
    const promotionId = testId('promotion');
    const onCutoff = row(promotionId, parseGameDate('2025-03-17'));
    expect(planCompaction([onCutoff], onCutoff.date)).toEqual({ keep: [], toMonth: [], drop: [] });
  });
});
