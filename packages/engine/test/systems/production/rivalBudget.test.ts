// The temporary rival production budget (ECO7-05), until AIP8.
// Design: docs/design/production.md#rival-production-budget
import { describe, expect, it } from 'vitest';
import type { PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { PhaseRegistry } from '../../../src/core/pipeline/registry';
import { runDay } from '../../../src/core/pipeline/runDay';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Production } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { RIVAL_LEDGER_ENTRY_TRACE_KIND } from '../../../src/systems/finance';
import { RIVAL_BUDGET_PHASE_ID, rivalBudgetPhase } from '../../../src/systems/production';
import { createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';
import { COMPUTER, PLAYER } from './production-world';
import { ALTURA, HARDPAN } from './support';

interface BudgetWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
}

/**
 * A: human, Hardpan's levels, only $100 in cash. B: computer, Altura's levels (popularity ceiling
 * 95), `rivalCash` in cents, popularity `rivalPop` in North 1. Mini geography, 31 Jan 2026.
 */
function budgetWorld(rivalCash: number, rivalPop: number): BudgetWorld {
  const built = worldBuilder({ startDate: '2026-01-05', currentDate: '2026-01-31' })
    .withGeography('mini')
    .withPromotion({
      name: 'Hardpan',
      controller: PLAYER,
      production: HARDPAN,
      cash: cents(10_000),
    })
    .withPromotion({
      name: 'Rival',
      controller: COMPUTER,
      production: ALTURA,
      cash: cents(rivalCash),
    })
    .with('popularity', (context) => {
      const rival = context.ids.promotions.B;
      const north1: RegionId | undefined = context.ids.regions[0];
      if (rival === undefined || north1 === undefined) throw new Error('budgetWorld: ids');
      context.tx.update('promotions', rival, { regionalPop: { [north1]: rivalPop } });
    })
    .build();
  const { A: human, B: rival } = built.ids.promotions;
  if (human === undefined || rival === undefined) throw new Error('budgetWorld: promotions');
  return { world: built.world, human, rival };
}

function runtimeOf(world: GameWorld, overrides: TunableOverrides = {}): SimRuntime {
  const phases = new PhaseRegistry();
  phases.register(rivalBudgetPhase);
  return createRuntime({ world, tunables: createEngineTunables(overrides), phases });
}

/** Runs 31 January and 1 February. */
function runToFirst(runtime: SimRuntime): void {
  for (let day = 0; day < 2; day += 1) {
    const report = runDay(runtime);
    const failed = report.steps.filter((step) => step.status === 'failed');
    if (failed.length > 0) throw new Error(JSON.stringify(failed));
  }
}

function levelsOf(world: GameWorld, promotionId: PromotionId): Production {
  return world.tables.promotions.require(promotionId).production;
}

function levelChanges(runtime: SimRuntime) {
  return runtime.bus
    .recent({ limit: 200 })
    .flatMap((event) => (event.type === 'production.levelChanged' ? [event.payload] : []));
}

describe('the rival production budget', () => {
  it('runs on the 1st in the money group, before the monthly overhead', () => {
    const phases = defaultSystems.flatMap((system) => system.phases);
    expect(phases.find((phase) => phase.id === RIVAL_BUDGET_PHASE_ID)).toMatchObject({
      group: 'money',
      order: 33,
      cadence: { kind: 'monthly', day: 1 },
    });
  });

  it('cuts music and writing first, through the door, and leaves the player alone', () => {
    // $100,000 against about $1.2M a month; harmful cuts held back.
    const built = budgetWorld(10_000_000, 95);
    const runtime = runtimeOf(built.world, { 'production.rivalBudget.deepCutBelowMonths': 0 });
    runToFirst(runtime);
    expect(levelsOf(built.world, built.rival)).toEqual({ ...ALTURA, music: 0, writing: 0 });
    expect(levelsOf(built.world, built.human)).toEqual(HARDPAN);
    const changes = levelChanges(runtime);
    expect(changes.length).toBe(ALTURA.music + ALTURA.writing);
    for (const change of changes) {
      expect(change).toMatchObject({ promotionId: built.rival, source: 'ai', fee: 0 });
    }
    // Lowering is free: nothing is posted.
    expect(built.world.tables.ledgerEntries.values()).toEqual([]);
  });

  it('cuts marketing and back office too once the money is short', () => {
    const built = budgetWorld(10_000_000, 95);
    const runtime = runtimeOf(built.world);
    runToFirst(runtime);
    const levels = levelsOf(built.world, built.rival);
    expect(levels).toMatchObject({ music: 0, writing: 0 });
    // Down until the cash covers 12 months of what is left.
    expect(levels.marketing).toBeLessThan(ALTURA.marketing);
    expect(levels.backOffice).toBeLessThan(ALTURA.backOffice);
    // No shows coming, so stage, camera, editing and pyro save nothing and stay.
    expect(levels).toMatchObject({ stage: 8, camera: 8, editing: 7, pyro: 8 });
  });

  it('keeps the levels the cash covers', () => {
    // $20M covers 12 months of Altura's $1.2M but not the 24 a raise needs.
    const built = budgetWorld(2_000_000_000, 95);
    const runtime = runtimeOf(built.world);
    runToFirst(runtime);
    expect(levelsOf(built.world, built.rival)).toEqual(ALTURA);
  });

  it('raises a held-back ceiling one step when rich, paying the fee as a hidden rival row', () => {
    const built = budgetWorld(50_000_000_000, 95);
    const runtime = runtimeOf(built.world);
    runToFirst(runtime);
    const changes = levelChanges(runtime);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(['marketing', 'backOffice']).toContain(change?.area);
    expect(change).toMatchObject({ source: 'ai', to: (change?.from ?? 0) + 1 });
    expect(change?.fee).toBeGreaterThan(0);
    const [row] = built.world.tables.ledgerEntries.values();
    expect(row).toMatchObject({
      promotionId: built.rival,
      category: 'production',
      amount: -(change?.fee ?? 0),
    });
    expect(row?.traceRef?.kind).toBe(RIVAL_LEDGER_ENTRY_TRACE_KIND);
    expect(runtime.traces.get(row?.traceRef ?? { kind: 'x', id: 'x' })).toMatchObject({
      summaryOnly: true,
    });
  });

  it('does not raise a level nothing is held back by', () => {
    const built = budgetWorld(50_000_000_000, 40);
    const runtime = runtimeOf(built.world);
    runToFirst(runtime);
    expect(levelChanges(runtime)).toEqual([]);
  });

  it('does nothing when both month tunables are 0', () => {
    const built = budgetWorld(0, 95);
    const runtime = runtimeOf(built.world, {
      'production.rivalBudget.lowerBelowMonths': 0,
      'production.rivalBudget.raiseAboveMonths': 0,
    });
    runToFirst(runtime);
    expect(levelsOf(built.world, built.rival)).toEqual(ALTURA);
  });
});
