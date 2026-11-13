// roster.summary: the counts behind the roster's tabs and brand selector agree with the rows.
// Design: docs/design/roster.md#roster-summary
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import type { BrandId } from '../../../src/core/ids';
import {
  ROSTER_NOT_YOURS,
  ROSTER_PUSHES,
  ROSTER_ROLE_GROUPS,
  ROSTER_TOP_COUNT,
  rosterSystem,
  type RosterSummary,
  type RosterSummaryArgs,
} from '../../../src/systems/roster';
import { workersSystem } from '../../../src/systems/workers';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';
import { OMNISCIENT, PLAYER, rosterOf, rosterTestWorld, TODAY } from './roster-world';

function summaryOf(engine: Engine, args: RosterSummaryArgs = {}, viewer = PLAYER): RosterSummary {
  const result = engine.query('roster.summary', args, viewer);
  if (!result.ok) {
    throw new Error(`roster.summary was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Eight wrestlers of promotion A: index 1 injured, index 2 suspended, the rest available. */
function unavailableWorld(): Engine {
  const { world } = worldBuilder({ startDate: TEST_START_DATE, currentDate: TODAY })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        regionalPop: { [testId('region', 1)]: 40 },
      },
      (promotion) =>
        promotion.withRoster(8, {
          person: (index) =>
            index === 1
              ? {
                  injury: {
                    kindKey: parseContentKey('injury.torn-acl'),
                    bodyPart: 'legs',
                    since: TEST_START_DATE,
                    expectedReturn: addDays(TODAY, 30),
                    canWorkAngles: false,
                  },
                }
              : {},
          employment: (index) =>
            index === 2
              ? { leave: { kind: 'suspension', until: addDays(TODAY, 14), paid: false } }
              : {},
        }),
    )
    .build();
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem, rosterSystem],
  });
}

describe('roster.summary', () => {
  const world = rosterTestWorld();
  const rows = rosterOf(world.engine).rows;
  const summary = summaryOf(world.engine);

  it('counts every row once in its group, with every group and card position present', () => {
    expectSerialisable(summary);
    expect(Object.keys(summary.byGroup)).toEqual([...ROSTER_ROLE_GROUPS]);
    expect(Object.keys(summary.byPush)).toEqual([...ROSTER_PUSHES]);
    expect(summary.total).toBe(rows.length);
    expect(sum(Object.values(summary.byGroup))).toBe(summary.total);
    expect(summary.byGroup.managers).toBe(0);
    expect(sum(Object.values(summary.byPush))).toBe(summary.byGroup.wrestlers);
  });

  it('lists the brands by priority, then Shared, and their sizes add up to the roster', () => {
    expect(summary.byBrand.map((brand) => [brand.brandId, brand.priority])).toEqual([
      [world.flagship, 0],
      [world.second, 1],
      [null, null],
    ]);
    expect(summary.byBrand.at(-1)?.name).toBe('Shared');
    expect(sum(summary.byBrand.map((brand) => brand.total))).toBe(rows.length);
    for (const brand of summary.byBrand) {
      const brandRows = rows.filter((row) => row.brandId === brand.brandId);
      expect(brand.total).toBe(brandRows.length);
      expect(brand.wrestlers).toBe(brandRows.filter((row) => row.group === 'wrestlers').length);
    }
  });

  it('follows a brand filter in its counts but keeps every brand in byBrand', () => {
    const filters: readonly (BrandId | 'shared')[] = [world.flagship, world.second, 'shared'];
    for (const brandId of filters) {
      const filtered = summaryOf(world.engine, { brandId });
      const filteredRows = rosterOf(world.engine, { brandId }).rows;
      const entry = summary.byBrand.find(
        (brand) => brand.brandId === (brandId === 'shared' ? null : brandId),
      );
      expect(filtered.byBrand).toEqual(summary.byBrand);
      expect(filtered.total).toBe(filteredRows.length);
      expect(sum(Object.values(filtered.byGroup))).toBe(filteredRows.length);
      expect(filtered.byGroup.wrestlers).toBe(entry?.wrestlers);
      for (const row of filtered.topByPopularity) {
        expect(filteredRows.map((each) => each.employmentId)).toContain(row.employmentId);
      }
    }
  });

  it('counts the wrestlers who expect a bigger push', () => {
    const expecting = rows.filter((row) => row.pushGap?.verdict === 'expectsMore').length;
    expect(expecting).toBeGreaterThan(0);
    expect(summary.expectsMore).toBe(expecting);
  });

  it('puts the five most popular wrestlers on top, then by overall, then by contract', () => {
    const top = summary.topByPopularity;
    expect(ROSTER_TOP_COUNT).toBe(5);
    expect(top).toHaveLength(ROSTER_TOP_COUNT);
    expect(top.every((row) => row.group === 'wrestlers')).toBe(true);
    const expected = rows
      .filter((row) => row.group === 'wrestlers')
      .sort(
        (left, right) =>
          right.popularity - left.popularity ||
          right.overall.value - left.overall.value ||
          (left.employmentId < right.employmentId ? -1 : 1),
      )
      .slice(0, ROSTER_TOP_COUNT);
    expect(top).toEqual(expected);
    for (const [index, row] of top.slice(1).entries()) {
      expect(row.popularity).toBeLessThanOrEqual(top[index]?.popularity ?? Infinity);
    }
  });

  it('refuses with the same reason as the rows', () => {
    const refused = summaryOf(world.engine, { promotionId: world.rival });
    expectSerialisable(refused);
    expect(refused).toMatchObject({
      promotion: null,
      unavailableReason: ROSTER_NOT_YOURS,
      total: 0,
      byBrand: [],
      topByPopularity: [],
    });
    expect(sum(Object.values(refused.byGroup))).toBe(0);
    expect(summaryOf(world.engine, { promotionId: world.rival }, OMNISCIENT).total).toBe(3);
  });

  it('counts the injured and the suspended as unavailable, by status', () => {
    const injured = summaryOf(unavailableWorld());
    expect(injured.total).toBe(8);
    expect(injured.unavailable).toBe(2);
    expect(injured.unavailableByStatus).toEqual({ injured: 1, suspended: 1 });
  });
});
