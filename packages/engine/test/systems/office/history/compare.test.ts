// Reading the promotion history back (DAY2-03): the compared row and the sparkline.
// Design: docs/design/office.md#kpis-and-deltas
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../../src/core/date';
import {
  previousSnapshot,
  registerPromotionSnapshotField,
  trendSeries,
} from '../../../../src/systems/office';
import { worldBuilder } from '../../../support/world-builder';

const TODAY = parseGameDate('2026-03-04');

function historyWorld() {
  const { world, ids } = worldBuilder({ currentDate: TODAY })
    .withGeography('mini')
    .withPromotion({ prestige: 50 })
    .withPromotionSnapshots('A', [
      { date: '2025-12-31', granularity: 'month', prestige: 40, extra: { 'test.hype': 1 } },
      { date: '2026-02-16', granularity: 'week', prestige: 44 },
      { date: '2026-02-23', granularity: 'week', prestige: 45, extra: { 'test.hype': 3 } },
      { date: '2026-03-02', granularity: 'week', prestige: 46, extra: { 'test.hype': 0 } },
    ])
    .build();
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) throw new Error('setup');
  return { world, promotionId };
}

let unregister: (() => void)[] = [];
afterEach(() => {
  for (const remove of unregister) remove();
  unregister = [];
});

describe('previousSnapshot', () => {
  it('is the latest row on or before today minus the lookback', () => {
    const { world, promotionId } = historyWorld();
    expect(previousSnapshot(world, promotionId, TODAY, 7)?.date).toBe('2026-02-23');
    expect(previousSnapshot(world, promotionId, TODAY, 2)?.date).toBe('2026-03-02');
    expect(previousSnapshot(world, promotionId, TODAY, 30)?.date).toBe('2025-12-31');
    expect(previousSnapshot(world, promotionId, TODAY, 90)).toBeNull();
  });
});

describe('trendSeries', () => {
  it('lists the rows in the window, oldest first, then the live value dated today', () => {
    const { world, promotionId } = historyWorld();
    expect(trendSeries(world, promotionId, 'prestige', TODAY, 8, 50)).toEqual({
      dates: ['2026-02-16', '2026-02-23', '2026-03-02', TODAY],
      values: [44, 45, 46, 50],
    });
    expect(trendSeries(world, promotionId, 'prestige', TODAY, 52, null).values).toEqual([
      40, 44, 45, 46,
    ]);
  });

  it('skips rows that lack a registered field instead of drawing 0', () => {
    unregister.push(
      registerPromotionSnapshotField({
        key: 'test.hype',
        label: 'Hype',
        unit: 'points',
        visibility: 'public',
        extract: () => 2,
      }),
    );
    const { world, promotionId } = historyWorld();
    expect(trendSeries(world, promotionId, 'test.hype', TODAY, 8, 2)).toEqual({
      dates: ['2026-02-23', '2026-03-02', TODAY],
      values: [3, 0, 2],
    });
  });
});
