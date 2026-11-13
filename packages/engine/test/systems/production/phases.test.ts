// The monthly overhead and the popularity drag (ECO7-03). Design:
// docs/design/production.md#monthly-overhead and #popularity-drag
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import type { PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import { PhaseRegistry } from '../../../src/core/pipeline/registry';
import { runDay } from '../../../src/core/pipeline/runDay';
import { walkTrace } from '../../../src/core/trace';
import { isFullTrace, type TraceRef } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { LedgerEntry } from '../../../src/model/entities/ledger-entry';
import type { Production } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  MONTHLY_OVERHEAD_TRACE_KIND,
  monthlyOverheadTraceRef,
  POPULARITY_DRAG_REASON_KEY,
  productionMonthlyCost,
  productionPhases,
} from '../../../src/systems/production';
import { createEngineTunables } from '../../../src/systems/tunables';
import { DOOR_TRACE_KINDS } from '../../../src/systems/workers/doors';
import { worldBuilder } from '../../support';
import { ALTURA, HARDPAN, NOTHING } from './support';
import { COMPUTER, PLAYER } from './production-world';

interface PhasesWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly closed: PromotionId;
  readonly regions: readonly RegionId[];
}

interface PhasesWorldOptions {
  readonly today?: string;
  readonly humanLevels?: Production;
  /** The human promotion's popularity by region index (mini geography). */
  readonly humanPop?: Readonly<Record<number, number>>;
}

/**
 * A: human, Hardpan's levels by default, $100,000. B: computer, Altura's levels. C: closed,
 * Altura's levels. Mini geography.
 */
function phasesWorld(options: PhasesWorldOptions = {}): PhasesWorld {
  let regions: RegionId[] = [];
  const built = worldBuilder({
    startDate: '2026-01-05',
    currentDate: options.today ?? '2026-01-31',
  })
    .withGeography('mini')
    .withPromotion({
      name: 'Hardpan',
      controller: PLAYER,
      production: options.humanLevels ?? HARDPAN,
      cash: cents(10_000_000),
    })
    .withPromotion({
      name: 'Rival',
      controller: COMPUTER,
      production: ALTURA,
      cash: cents(500_000_000),
    })
    .withPromotion({
      name: 'Gone',
      controller: COMPUTER,
      production: ALTURA,
      cash: cents(500_000_000),
      status: 'closed',
    })
    .with('popularity', (context) => {
      regions = [...context.ids.regions];
      const human = context.ids.promotions.A;
      if (human === undefined) throw new Error('no promotion A');
      const regionalPop: Record<RegionId, number> = {};
      for (const [index, value] of Object.entries(options.humanPop ?? {})) {
        const regionId = regions[Number(index)];
        if (regionId === undefined) throw new Error(`no region ${index}`);
        regionalPop[regionId] = value;
      }
      context.tx.update('promotions', human, { regionalPop });
    })
    .build();
  const id = (key: 'A' | 'B' | 'C'): PromotionId => {
    const value = built.ids.promotions[key];
    if (value === undefined) throw new Error(`no promotion ${key}`);
    return value;
  };
  return { world: built.world, human: id('A'), rival: id('B'), closed: id('C'), regions };
}

function runtimeOf(world: GameWorld, overrides: TunableOverrides = {}): SimRuntime {
  const phases = new PhaseRegistry();
  for (const phase of productionPhases) {
    phases.register(phase);
  }
  return createRuntime({ world, tunables: createEngineTunables(overrides), phases });
}

function runDays(runtime: SimRuntime, days: number): void {
  for (let day = 0; day < days; day += 1) {
    const report = runDay(runtime);
    const failed = report.steps.filter((step) => step.status === 'failed');
    if (failed.length > 0) throw new Error(JSON.stringify(failed));
  }
}

const CATEGORY_ORDER: readonly string[] = ['production', 'marketing', 'backOffice'];

/** The promotion's rows by date, then Production, Marketing, Back office (ids are not ordered). */
function rowsOf(world: GameWorld, promotionId: PromotionId): LedgerEntry[] {
  return world.tables.ledgerEntries
    .lookup('byPromotion', promotionId)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category),
    );
}

function labelsOf(runtime: SimRuntime, ref: TraceRef): string[] {
  const stored = runtime.traces.get(ref);
  if (stored === undefined || !isFullTrace(stored)) throw new Error('expected a full trace');
  const labels: string[] = [];
  walkTrace(stored.trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

function popularityEvents(runtime: SimRuntime) {
  return runtime.bus.recent({ limit: 100 }).filter((event) => event.type === 'popularity.changed');
}

function setLevels(world: GameWorld, promotionId: PromotionId, production: Production): void {
  const result = world.transact('test: levels', (tx) => {
    tx.update('promotions', promotionId, { production });
  });
  if (!result.ok) throw result.error;
}

describe('the production phases', () => {
  it('are registered: overhead on the 1st at money 35, drag daily at growth 90', () => {
    const phases = defaultSystems.flatMap((system) => system.phases);
    expect(phases.find((phase) => phase.id === 'production.monthlyOverhead')).toMatchObject({
      group: 'money',
      order: 35,
      cadence: { kind: 'monthly', day: 1 },
    });
    expect(phases.find((phase) => phase.id === 'production.popularityDrag')).toMatchObject({
      group: 'growth',
      order: 90,
      cadence: { kind: 'daily' },
    });
  });
});

describe('the monthly overhead', () => {
  it('posts Production, Marketing and Back office rows on the 1st, matching the cash change', () => {
    const built = phasesWorld();
    const runtime = runtimeOf(built.world);
    runDays(runtime, 1); // 31 January
    expect(rowsOf(built.world, built.human)).toEqual([]);

    const cashBefore = built.world.tables.promotions.require(built.human).cash;
    runDays(runtime, 1); // 1 February
    const rows = rowsOf(built.world, built.human);
    expect(
      rows.map(({ category, amount, date, memo }) => ({ category, amount, date, memo })),
    ).toEqual([
      {
        category: 'production',
        amount: -250_000,
        date: parseGameDate('2026-02-01'),
        memo: 'Production overhead for February 2026',
      },
      {
        category: 'marketing',
        amount: -120_000,
        date: parseGameDate('2026-02-01'),
        memo: 'Marketing overhead for February 2026',
      },
      {
        category: 'backOffice',
        amount: -100_000,
        date: parseGameDate('2026-02-01'),
        memo: 'Back office overhead for February 2026',
      },
    ]);
    const cashAfter = built.world.tables.promotions.require(built.human).cash;
    expect(cashAfter - cashBefore).toBe(rows.reduce((sum, row) => sum + row.amount, 0));

    // Each row's Why? names the areas behind it.
    const [production, marketing] = rows;
    const productionLabels = labelsOf(runtime, production?.traceRef ?? { kind: 'x', id: 'x' });
    expect(productionLabels).toContain('Music (level 1)');
    expect(productionLabels).toContain('Writing (level 2)');
    expect(productionLabels).not.toContain('Marketing (level 1)');
    expect(labelsOf(runtime, marketing?.traceRef ?? { kind: 'x', id: 'x' })).toContain(
      'Marketing (level 1)',
    );

    // The total is kept for the Production screen's "last charged" line.
    const total = runtime.traces.get(monthlyOverheadTraceRef(built.human));
    expect(total?.value).toBe(470_000);
    expect(monthlyOverheadTraceRef(built.human).kind).toBe(MONTHLY_OVERHEAD_TRACE_KIND);

    runDays(runtime, 1); // 2 February: nothing more
    expect(rowsOf(built.world, built.human)).toHaveLength(3);
  });

  it('charges a computer promotion the same way, and a closed one nothing', () => {
    const built = phasesWorld();
    const runtime = runtimeOf(built.world);
    runDays(runtime, 2);
    const expected = productionMonthlyCost(
      { promotionName: 'Rival', levels: ALTURA },
      { tunables: createEngineTunables() },
    );
    const rows = rowsOf(built.world, built.rival);
    expect(rows.map((row) => [row.category, row.amount])).toEqual([
      ['production', -expected.byCategory.production.value],
      ['marketing', -expected.byCategory.marketing.value],
      ['backOffice', -expected.byCategory.backOffice.value],
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(-121_465_000);
    // A rival's overhead total is kept only as a summary.
    const stored = runtime.traces.get(monthlyOverheadTraceRef(built.rival));
    expect(stored === undefined || isFullTrace(stored)).toBe(false);
    expect(rowsOf(built.world, built.closed)).toEqual([]);
  });

  it('posts nothing for a category at 0, and nothing at all with every monthly area at 0', () => {
    const built = phasesWorld({ humanLevels: { ...HARDPAN, marketing: 0 } });
    const runtime = runtimeOf(built.world);
    runDays(runtime, 2);
    expect(rowsOf(built.world, built.human).map((row) => row.category)).toEqual([
      'production',
      'backOffice',
    ]);

    const none = phasesWorld({ humanLevels: { ...ALTURA, ...NOTHING } });
    const noneRuntime = runtimeOf(none.world);
    runDays(noneRuntime, 2);
    expect(rowsOf(none.world, none.human)).toEqual([]);
    expect(noneRuntime.traces.get(monthlyOverheadTraceRef(none.human))).toBeUndefined();
  });

  it('charges a level raised on the 15th at the new level on the next 1st', () => {
    const built = phasesWorld();
    const runtime = runtimeOf(built.world);
    runDays(runtime, 15); // 31 January to 14 February
    setLevels(built.world, built.human, { ...HARDPAN, marketing: 4 });
    runDays(runtime, 14); // 15 February to 28 February
    expect(rowsOf(built.world, built.human)).toHaveLength(3);
    runDays(runtime, 1); // 1 March
    const march = rowsOf(built.world, built.human).filter(
      (row) => row.date === parseGameDate('2026-03-01'),
    );
    // Marketing at level 4: 0.4³ × $1,200,000 = $76,800.
    expect(march.map((row) => [row.category, row.amount])).toEqual([
      ['production', -250_000],
      ['marketing', -7_680_000],
      ['backOffice', -100_000],
    ]);
  });
});

describe('the popularity drag', () => {
  const NO_CEILING_HELP: Production = { ...HARDPAN, marketing: 0, backOffice: 0 }; // ceiling 20

  function popOf(built: PhasesWorld, index: number): number | undefined {
    const regionId = built.regions[index];
    if (regionId === undefined) throw new Error(`no region ${String(index)}`);
    return built.world.tables.promotions.require(built.human).regionalPop[regionId];
  }

  it('takes max(0.05, 0.02 × excess) off a region above the ceiling, through one door call', () => {
    const built = phasesWorld({
      today: '2026-01-05',
      humanLevels: NO_CEILING_HELP,
      humanPop: { 0: 50, 1: 20.03, 2: 15 },
    });
    const runtime = runtimeOf(built.world);
    runDays(runtime, 1);
    expect(popOf(built, 0)).toBe(49.4);
    expect(popOf(built, 1)).toBe(20);
    expect(popOf(built, 2)).toBe(15);

    const events = runtime.bus
      .recent({ limit: 100 })
      .filter((event) => event.type === 'popularity.changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      subjectKind: 'promotion',
      subjectId: built.human,
      regionsChanged: 2,
      source: 'system',
      reasonKey: POPULARITY_DRAG_REASON_KEY,
    });

    const regionName = built.world.tables.regions.require(
      built.regions[0] ?? ('' as RegionId),
    ).name;
    const labels = labelsOf(runtime, {
      kind: DOOR_TRACE_KINDS.promotionPopularity,
      id: built.human,
    });
    expect(labels).toContain(
      "Popularity change: Marketing and back office can't support this popularity",
    );
    expect(labels).toContain(`Production popularity drag in ${regionName}`);
    expect(labels).toContain(`Popularity drag in ${regionName}`);
    expect(labels).toContain('Hardpan popularity ceiling');
  });

  it('leaves a promotion at or under its ceiling alone', () => {
    const built = phasesWorld({ today: '2026-01-05', humanPop: { 0: 30, 1: 12 } }); // ceiling 30
    const runtime = runtimeOf(built.world);
    runDays(runtime, 3);
    expect(popOf(built, 0)).toBe(30);
    expect(popOf(built, 1)).toBe(12);
    expect(popularityEvents(runtime)).toEqual([]);
  });

  it('does nothing with fractionPerDay 0 and minPerDay 0', () => {
    const built = phasesWorld({
      today: '2026-01-05',
      humanLevels: NO_CEILING_HELP,
      humanPop: { 0: 50 },
    });
    const runtime = runtimeOf(built.world, {
      'production.popularityDrag.fractionPerDay': 0,
      'production.popularityDrag.minPerDay': 0,
    });
    runDays(runtime, 2);
    expect(popOf(built, 0)).toBe(50);
    expect(popularityEvents(runtime)).toEqual([]);
  });

  it('stops at a ceiling that is not a whole hundredth, never below it', () => {
    // Ceiling 20.333…: 20.36 less its whole excess would store 20.33, below it, so the loss
    // stops at 20.34.
    const above = phasesWorld({
      today: '2026-01-05',
      humanLevels: NO_CEILING_HELP,
      humanPop: { 0: 20.36 },
    });
    const aboveRuntime = runtimeOf(above.world, {
      'production.popularityCeiling.base': 20 + 1 / 3,
    });
    runDays(aboveRuntime, 1);
    expect(popOf(above, 0)).toBe(20.34);
    runDays(aboveRuntime, 1);
    expect(popOf(above, 0)).toBe(20.34);
  });

  it("follows the door's drop rule when the ceiling is 0", () => {
    const built = phasesWorld({
      today: '2026-01-05',
      humanLevels: NO_CEILING_HELP,
      humanPop: { 0: 0.04 },
    });
    const runtime = runtimeOf(built.world, { 'production.popularityCeiling.base': 0 });
    runDays(runtime, 1);
    // 0.04 − 0.04 = 0: the region leaves the sparse map.
    expect(popOf(built, 0)).toBeUndefined();
  });

  it('converges on the ceiling over a year and never goes below it', () => {
    const built = phasesWorld({
      today: '2026-01-05',
      humanLevels: NO_CEILING_HELP,
      humanPop: { 0: 50 },
    });
    const runtime = runtimeOf(built.world);
    let lowest = 50;
    for (let day = 0; day < 365; day += 1) {
      runDays(runtime, 1);
      lowest = Math.min(lowest, popOf(built, 0) ?? 0);
    }
    expect(popOf(built, 0)).toBe(20);
    expect(lowest).toBe(20);
  });
});
