// Promotion history (DAY2-01): the weekly snapshot, the new-game baseline and the thinning of old
// weeks. Design: docs/design/office.md#history
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, parseGameDate, weekday, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import type { PromotionSnapshot } from '../../../src/model/entities/promotion-snapshot';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { createNewGame } from '../../../src/systems/newgame';
import {
  officeSystem,
  OFFICE_BASELINE_SNAPSHOT_STEP,
  weeklySnapshotPhase,
  writePromotionSnapshots,
} from '../../../src/systems/office';
import { createPopularityRoller } from '../../../src/systems/world/formulas/popularityRollup';
import { geographyOf } from '../../../src/systems/world/geography';
import { setupSteps } from '../../../src/systems/newgame';
import { miniWorldPacks } from '../../support/fixture-packs';
import { testId } from '../../support/ids';
import { worldBuilder, type WorldBuilder } from '../../support/world-builder';

const MONDAY = parseGameDate('2026-01-05');
const WEDNESDAY = parseGameDate('2026-01-07');
const MORALES = [10, 20, -6];

/**
 * Promotion A (active, popular in two regions, three wrestlers with morale 10, 20 and -6),
 * B (dormant, nobody under contract) and C (closed, with one old weekly row).
 */
function historyWorld(start: GameDate): WorldBuilder {
  return worldBuilder({ startDate: start, currentDate: start })
    .withGeography('mini')
    .withPromotion(
      {
        regionalPop: { [testId('region', 1)]: 40, [testId('region', 3)]: 12.5 },
        prestige: 61,
      },
      (promotion) =>
        promotion.withRoster(3, {
          employment: (index) => ({ morale: MORALES[index] ?? 0 }),
        }),
    )
    .withPromotion({ status: 'dormant' })
    .withPromotion({ status: 'closed' })
    .withPromotionSnapshots('C', [{ date: addDays(start, -14) }]);
}

function engineFor(world: GameWorld, overrides: EngineState['tunableOverrides'] = {}) {
  return createEngine({
    state: { ...initialEngineState(world), tunableOverrides: overrides },
    systems: [simSystem, officeSystem],
  });
}

function rowsOf(state: EngineState, promotionId: PromotionId | undefined): PromotionSnapshot[] {
  return state.world.tables.promotionSnapshots
    .filter((row) => row.promotionId === promotionId)
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
}

function writeBaseline(world: GameWorld, date: GameDate): void {
  const result = world.transact('baseline', (tx) =>
    writePromotionSnapshots(tx, date, 'baseline', ['active']),
  );
  if (!result.ok) {
    throw result.error;
  }
}

describe('office.weeklySnapshot', () => {
  it('runs on Mondays in the periodic group at order 34, and the default systems include it', () => {
    expect(weeklySnapshotPhase).toMatchObject({
      id: 'office.weeklySnapshot',
      group: 'periodic',
      order: 34,
      cadence: { kind: 'weekly', weekday: 'mon' },
    });
    expect(defaultSystems).toContain(officeSystem);
  });

  it('adds one row per open promotion on each Monday after a mid-week baseline', async () => {
    const { world, ids } = historyWorld(WEDNESDAY).build();
    writeBaseline(world, WEDNESDAY);
    const engine = engineFor(world);
    const advance = await engine.advanceDays({ maxDays: 14 });
    expect(advance.failures).toEqual([]);
    const state = engine.exportState();

    const rowsA = rowsOf(state, ids.promotions.A);
    expect(rowsA.map((row) => [row.date, row.granularity])).toEqual([
      [WEDNESDAY, 'baseline'],
      ['2026-01-12', 'week'],
      ['2026-01-19', 'week'],
    ]);
    // Dormant promotions keep getting rows (but no baseline: only active ones start with one).
    expect(rowsOf(state, ids.promotions.B).map((row) => row.date)).toEqual([
      '2026-01-12',
      '2026-01-19',
    ]);
    // A closed promotion gets nothing new but keeps what it had.
    expect(rowsOf(state, ids.promotions.C).map((row) => row.date)).toEqual([
      addDays(WEDNESDAY, -14),
    ]);
    for (const row of rowsA) {
      expect(weekday(row.date) === 0 || row.granularity === 'baseline').toBe(true);
    }

    const announced = state.events.recent
      .filter((event) => event.type === 'office.snapshotTaken')
      .map((event) => event.payload);
    expect(announced).toEqual([
      { date: '2026-01-12', promotionIds: [ids.promotions.A, ids.promotions.B] },
      { date: '2026-01-19', promotionIds: [ids.promotions.A, ids.promotions.B] },
    ]);
  });

  it('records the live cash, prestige, popularity, roster and morale', async () => {
    const { world, ids } = historyWorld(WEDNESDAY).build();
    const engine = engineFor(world);
    await engine.advanceDays({ maxDays: 6 });
    const state = engine.exportState();
    const promotion = state.world.tables.promotions.find((row) => row.id === ids.promotions.A);
    const [row] = rowsOf(state, ids.promotions.A);
    if (promotion === undefined || row === undefined) {
      throw new Error('missing promotion A or its row');
    }
    const geography = geographyOf(world);
    const rolled = createPopularityRoller(geography).rollValues(promotion.regionalPop);
    const homeCountry = geography.countryOf(promotion.homeRegionId);

    expect(row).toMatchObject({
      date: '2026-01-12',
      granularity: 'week',
      cash: promotion.cash,
      prestige: 61,
      rosterSize: 3,
      averageMorale: 8,
      extra: {},
    });
    expect(row.popularity.world).toBe(rolled.world);
    expect(row.popularity.homeRegionValue).toBe(40);
    expect(row.popularity.headline).toBe(rolled.countries[homeCountry.id]);
    expect(row.popularity.byContinent).toEqual({ [testId('continent')]: rolled.world });
    expect(row.popularity.world).toBeGreaterThan(0);
  });

  it('records no morale and a roster of 0 for a promotion with nobody under contract', async () => {
    const { world, ids } = historyWorld(WEDNESDAY).build();
    const engine = engineFor(world);
    await engine.advanceDays({ maxDays: 6 });
    const [row] = rowsOf(engine.exportState(), ids.promotions.B);
    expect(row).toMatchObject({
      rosterSize: 0,
      averageMorale: null,
      popularity: { headline: 0, world: 0, homeRegionValue: 0, byContinent: {} },
    });
  });

  it('turns a Monday baseline into that week’s row instead of adding a second one', async () => {
    const { world, ids } = historyWorld(MONDAY).build();
    writeBaseline(world, MONDAY);
    const engine = engineFor(world);
    await engine.advanceDays({ maxDays: 1 });
    const rows = rowsOf(engine.exportState(), ids.promotions.A);
    expect(rows.map((row) => [row.date, row.granularity])).toEqual([[MONDAY, 'week']]);
  });

  it('keeps a year of default history within 52 weeks and the baseline', async () => {
    const { world, ids } = historyWorld(WEDNESDAY).build();
    writeBaseline(world, WEDNESDAY);
    const engine = engineFor(world);
    const advance = await engine.advanceDays({ maxDays: 365 });
    expect(advance.failures).toEqual([]);
    const state = engine.exportState();
    const open = [ids.promotions.A, ids.promotions.B];
    for (const promotionId of open) {
      expect(rowsOf(state, promotionId).length).toBeLessThanOrEqual(52 + 1);
    }
    expect(state.world.tables.promotionSnapshots.length).toBeLessThanOrEqual(
      state.world.tables.promotions.length * (52 + 1),
    );
  });

  it('thins weeks older than fullDetailWeeks to one row per month and keeps the baseline', async () => {
    const { world, ids } = historyWorld(WEDNESDAY).build();
    writeBaseline(world, WEDNESDAY);
    const engine = engineFor(world, { 'office.history.fullDetailWeeks': 4 });
    await engine.advanceDays({ maxDays: 120 });
    const state = engine.exportState();
    const rows = rowsOf(state, ids.promotions.A);
    const lastMonday = rows.at(-1)?.date ?? WEDNESDAY;
    const cutoff = addDays(lastMonday, -7 * 4);

    expect(rows[0]).toMatchObject({ date: WEDNESDAY, granularity: 'baseline' });
    const weeks = rows.filter((row) => row.granularity === 'week');
    expect(weeks).toHaveLength(5);
    for (const row of weeks) {
      expect(row.date >= cutoff).toBe(true);
    }
    const months = rows.filter((row) => row.granularity === 'month');
    expect(months.map((row) => row.date.slice(0, 7))).toEqual([
      ...new Set(months.map((row) => row.date.slice(0, 7))),
    ]);
    expect(months.length).toBeGreaterThanOrEqual(3);
    for (const row of months) {
      expect(row.date < cutoff).toBe(true);
    }
  });
});

describe('office.baselineSnapshot', () => {
  it('runs at order 990, after every other setup step', () => {
    const steps = setupSteps();
    expect(steps.at(-1)).toEqual({ id: 'office.baselineSnapshot', order: 990 });
    expect(OFFICE_BASELINE_SNAPSHOT_STEP).toEqual({ id: 'office.baselineSnapshot', order: 990 });
  });

  it('gives a new game one baseline row per active promotion, dated the start', () => {
    const result = createNewGame(miniWorldPacks(), {
      rootPackId: 'mini-world',
      seed: 'office-history',
      playerId: 'local-player',
      playerName: 'Alex Booker',
      saveName: 'History',
      seasonLength: { preset: '12m' },
      player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
      settings: {},
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const { tables, meta } = result.state.world;
    const active = tables.promotions.filter((promotion) => promotion.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    expect(tables.promotionSnapshots.map((row) => row.promotionId)).toEqual(
      active.map((promotion) => promotion.id),
    );
    for (const row of tables.promotionSnapshots) {
      expect(row).toMatchObject({ date: meta.startDate, granularity: 'baseline' });
      const promotion = active.find((candidate) => candidate.id === row.promotionId);
      expect(row.cash).toBe(promotion?.cash);
    }
  });
});
