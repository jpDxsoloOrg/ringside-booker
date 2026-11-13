// DAY2's weekly snapshots as the hot-shot term's popularity history (AIP5-06). Design:
// docs/design/rival-booking.md#popularity-history
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../../src/core/date';
import type { PromotionId } from '../../../../src/core/ids';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { PromotionSnapshot } from '../../../../src/model/entities/promotion-snapshot';
import type { GameWorld } from '../../../../src/model/tables';
import {
  fewReadingsText,
  hotShotText,
  popularityHistoryOf,
  titleChangeChance,
  weeklyPopularityReadings,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import type { DeepPartial } from '../../../support/builders/build-row';
import { worldBuilder } from '../../../support/world-builder';

const tunables = createEngineTunables();
const WEEKS = tunables.get('aip.titles.hotShot.weeks');
const BONUS = tunables.get('aip.titles.hotShot.bonus');
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 7 * 6);

function weekRow(week: number, headline: number): DeepPartial<PromotionSnapshot> {
  return {
    date: addDays(TEST_START_DATE, 7 * week),
    granularity: 'week',
    popularity: { headline, world: headline, homeRegionValue: headline, byContinent: {} },
  };
}

function snapshotWorld(rows: readonly DeepPartial<PromotionSnapshot>[]): {
  world: GameWorld;
  promotionId: PromotionId;
} {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => promotion.withRoster(2))
    .withPromotionSnapshots('A', rows)
    .build();
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) {
    throw new Error('no promotion A');
  }
  return { world, promotionId };
}

function hotShotChance(
  world: GameWorld,
  promotionId: PromotionId,
): ReturnType<typeof titleChangeChance> {
  return titleChangeChance(
    {
      titleName: 'World Title',
      reignDays: 100,
      prestige: 60,
      titleTaste: inputOf('Title taste (style default)', 50),
      titleTasteSource: 'styleDefault',
      importance: 'regular',
      popularityHistory: popularityHistoryOf(world, promotionId, SHOW_DAY, WEEKS + 1),
    },
    { tunables },
  );
}

function hotShotAdded(result: ReturnType<typeof titleChangeChance>): number {
  return findTraceNodes(result.trace, 'add')
    .filter((node) => node.label === hotShotText(WEEKS))
    .reduce((sum, node) => sum + node.operand, 0);
}

describe('the office.snapshots popularity history', () => {
  it('reads weekly rows on or before the show, newest last, ignoring monthly and baseline rows', () => {
    const { world, promotionId } = snapshotWorld([
      { date: TEST_START_DATE, granularity: 'baseline', popularity: { headline: 99 } },
      weekRow(1, 40),
      { ...weekRow(2, 77), granularity: 'month' },
      weekRow(3, 30),
      weekRow(4, 20),
      weekRow(9, 5),
    ]);
    const readings = weeklyPopularityReadings(world, promotionId, SHOW_DAY, 10);
    expect(readings.map((reading) => reading.value)).toEqual([40, 30, 20]);
    expect(
      weeklyPopularityReadings(world, promotionId, SHOW_DAY, 2).map((reading) => reading.value),
    ).toEqual([30, 20]);
  });

  it(`adds the hot-shot bonus after ${String(WEEKS)} strictly falling weeks`, () => {
    const { world, promotionId } = snapshotWorld([
      weekRow(2, 50),
      weekRow(3, 45),
      weekRow(4, 40),
      weekRow(5, 35),
    ]);
    expect(hotShotAdded(hotShotChance(world, promotionId))).toBe(BONUS);
  });

  it('adds nothing when a flat week breaks the fall', () => {
    const { world, promotionId } = snapshotWorld([
      weekRow(2, 50),
      weekRow(3, 45),
      weekRow(4, 45),
      weekRow(5, 35),
    ]);
    const result = hotShotChance(world, promotionId);
    expect(hotShotAdded(result)).toBe(0);
    expect(findTraceNodes(result.trace, 'branch').map((node) => node.label)).toContain(
      hotShotText(WEEKS),
    );
  });

  it('reads "Only 0 weekly readings so far" in a brand-new game', () => {
    const { world, promotionId } = snapshotWorld([
      { date: TEST_START_DATE, granularity: 'baseline', popularity: { headline: 40 } },
    ]);
    const result = hotShotChance(world, promotionId);
    expect(hotShotAdded(result)).toBe(0);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain(
      fewReadingsText(0),
    );
  });
});
