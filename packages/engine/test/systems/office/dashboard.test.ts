// office.dashboard (DAY2-03): KPI cards with deltas and trends, the clock and the world overview.
// Design: docs/design/office.md#kpis-and-deltas
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, parseGameDate } from '../../../src/core/date';
import { mapTraced, untraced } from '../../../src/core/trace';
import type { PromotionSnapshot } from '../../../src/model/entities/promotion-snapshot';
import { registerPromotionSnapshotField, type OfficeKpi } from '../../../src/systems/office';
import { expectSerialisable } from '../../support/trace';
import {
  HUMAN_VIEWER,
  MONDAY,
  officeWorld,
  queryOk,
  SPECTATOR_VIEWER,
  WEDNESDAY,
} from './office-world';

let unregister: (() => void)[] = [];

afterEach(() => {
  for (const remove of unregister) remove();
  unregister = [];
});

function kpi(kpis: readonly OfficeKpi[], key: string): OfficeKpi {
  const found = kpis.find((card) => card.key === key);
  if (found === undefined) throw new Error(`no KPI ${key}`);
  return found;
}

function rowsOf(world: Awaited<ReturnType<typeof officeWorld>>): PromotionSnapshot[] {
  return world.engine
    .exportState()
    .world.tables.promotionSnapshots.filter((row) => row.promotionId === world.human)
    .sort((left, right) => (left.date < right.date ? -1 : 1));
}

describe('office.dashboard for the viewer’s promotion', () => {
  // A Monday start run for 22 days: rows on 5, 12, 19 and 26 January, today Tuesday 27 January.
  const TODAY = parseGameDate('2026-01-27');

  it('shows the five built-in cards with deltas against last Monday and trends ending today', async () => {
    const world = await officeWorld(MONDAY, 22);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, HUMAN_VIEWER);
    expectSerialisable(dashboard);

    const rows = rowsOf(world);
    expect(rows.map((row) => [row.date, row.granularity])).toEqual([
      ['2026-01-05', 'week'],
      ['2026-01-12', 'week'],
      ['2026-01-19', 'week'],
      ['2026-01-26', 'week'],
    ]);
    expect(dashboard.date).toBe(TODAY);
    expect(dashboard.promotion).toMatchObject({
      promotionId: world.human,
      name: 'Altura Wrestling',
    });
    expect(dashboard.worldOverview).toBeNull();
    expect(dashboard.kpis.map((card) => card.key)).toEqual([
      'cash',
      'popularity.headline',
      'prestige',
      'rosterSize',
      'averageMorale',
    ]);

    const status = queryOk(world.engine, 'sim.status', {}, HUMAN_VIEWER);
    const compared = rows.find((row) => row.date === '2026-01-19');
    if (compared === undefined || status.promotion === null) throw new Error('setup');
    for (const card of dashboard.kpis) {
      expect(card.delta?.previousDate).toBe(addDays(TODAY, -8));
      expect(card.trend.dates.at(-1)).toBe(TODAY);
      expect(card.trend.values.at(-1)).toBe(card.value);
      expect(card.trend.dates.slice(0, -1)).toEqual(rows.map((row) => row.date));
    }

    const cash = kpi(dashboard.kpis, 'cash');
    expect(cash.value).toBe(status.promotion.cash);
    expect(cash.traceRef).toEqual(status.promotion.cashTraceRef);
    expect(cash.delta?.previousValue).toBe(compared.cash);
    expect(cash.delta?.value).toBe(status.promotion.cash - compared.cash);
    expect(cash.trend.values.slice(0, -1)).toEqual(rows.map((row) => row.cash));

    const popularity = kpi(dashboard.kpis, 'popularity.headline');
    expect(popularity.value).toBe(status.promotion.popularity.headline);
    expect(popularity.traceRef).toEqual(status.promotion.popularity.traceRef);
    expect(popularity.trace).toBeNull();
    expect(popularity.footer).toMatch(/^In /);

    const prestige = kpi(dashboard.kpis, 'prestige');
    expect(prestige).toMatchObject({ value: 61, trace: null, traceRef: null });
    expect(prestige.delta).toMatchObject({ value: 0, previousValue: 61 });

    const roster = kpi(dashboard.kpis, 'rosterSize');
    expect(roster).toMatchObject({ value: 3, unit: 'count', footer: '3 wrestlers · 0 crew' });
    expect(roster.trace?.label).toBe('Roster size');

    const morale = kpi(dashboard.kpis, 'averageMorale');
    expect(morale.value).toBeCloseTo(rows.at(-1)?.averageMorale ?? Number.NaN, 0);
    expect(morale.delta?.previousValue).toBe(compared.averageMorale);
    expect(morale.trace?.label).toBe('Average morale');
    expect(morale.delta?.trace.label).toBe('Change in Average morale since Mon 19 Jan');
  });

  it('adds a registered KPI field after the built-ins, by order, with its delta', async () => {
    unregister.push(
      registerPromotionSnapshotField({
        key: 'test.second',
        label: 'Second',
        unit: 'count',
        visibility: 'owner',
        extract: () => 2,
        kpi: { order: 20, goodWhen: 'down' },
      }),
      registerPromotionSnapshotField({
        key: 'test.first',
        label: 'First',
        unit: 'points',
        visibility: 'public',
        extract: (promotion) =>
          mapTraced(untraced(promotion.prestige, 'Prestige'), 'Half prestige', (v) => v / 2),
        kpi: { order: 10, goodWhen: 'up', footer: 'Half the prestige' },
      }),
      registerPromotionSnapshotField({
        key: 'test.notKpi',
        label: 'Not a card',
        unit: 'points',
        visibility: 'public',
        extract: () => 1,
      }),
    );
    const world = await officeWorld(MONDAY, 22);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, HUMAN_VIEWER);
    expect(dashboard.kpis.map((card) => card.key).slice(5)).toEqual(['test.first', 'test.second']);
    const first = kpi(dashboard.kpis, 'test.first');
    expect(first).toMatchObject({ value: 30.5, footer: 'Half the prestige', goodWhen: 'up' });
    expect(first.trace?.label).toBe('Half prestige');
    expect(first.delta).toMatchObject({ value: 0, previousValue: 30.5 });
    expect(kpi(dashboard.kpis, 'test.second')).toMatchObject({
      value: 2,
      goodWhen: 'down',
      trace: null,
      delta: { value: 0, previousDate: '2026-01-19' },
    });
  });

  it('gives no delta, not 0, while only the baseline row exists and it is under a week old', async () => {
    const world = await officeWorld(WEDNESDAY, 3);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, HUMAN_VIEWER);
    expect(dashboard.kpis).toHaveLength(5);
    for (const card of dashboard.kpis) {
      expect(card.delta).toBeNull();
      expect(card.trend.dates).toEqual([WEDNESDAY, addDays(WEDNESDAY, 3)]);
    }
  });

  it('compares with the baseline once it is a week old', async () => {
    const world = await officeWorld(WEDNESDAY, 7);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, HUMAN_VIEWER);
    const prestige = kpi(dashboard.kpis, 'prestige');
    expect(prestige.delta?.previousDate).toBe(WEDNESDAY);
    expect(prestige.delta?.trace.children?.map((node) => node.label)).toContain(
      'This compares with the day the game began',
    );
  });

  it('shows the clock with the next Monday as the next snapshot', async () => {
    const world = await officeWorld(WEDNESDAY, 3);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, HUMAN_VIEWER);
    const clock = queryOk(world.engine, 'clock.get', {}, HUMAN_VIEWER);
    expect(dashboard.clock).toMatchObject({ ...clock, nextSnapshotOn: '2026-01-12' });
    const monday = await officeWorld(WEDNESDAY, 5);
    expect(queryOk(monday.engine, 'office.dashboard', {}, HUMAN_VIEWER).clock.nextSnapshotOn).toBe(
      '2026-01-12',
    );
  });
});

describe('office.dashboard for a seat with no promotion', () => {
  it('gives the world overview and no KPIs', async () => {
    const world = await officeWorld(MONDAY, 8);
    const dashboard = queryOk(world.engine, 'office.dashboard', {}, SPECTATOR_VIEWER);
    expect(dashboard.promotion).toBeNull();
    expect(dashboard.kpis).toEqual([]);
    const overview = dashboard.worldOverview;
    if (overview === null) throw new Error('expected an overview');
    expect(overview.promotions.map((row) => row.promotionId)).toEqual([world.human, world.rival]);
    expect(overview.promotions[0]).toMatchObject({
      name: 'Altura Wrestling',
      prestige: 61,
      rosterSize: 3,
      status: 'active',
    });
    expect(overview.promotions[0]?.headline).toBeGreaterThan(0);
    expect(overview.totals).toEqual({ promotions: 2, wrestlersUnderContract: 5 });
    expect(overview.freeAgents).toBe(0);
  });
});
