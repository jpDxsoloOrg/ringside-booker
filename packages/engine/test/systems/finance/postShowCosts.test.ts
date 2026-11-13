// Posting a completed show's costs (ECO1-04). Design: docs/design/finances.md#show-costs
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, OMNISCIENT_VIEWER } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { EventInstanceId, PromotionId } from '../../../src/core/ids';
import type { StepContext } from '../../../src/core/pipeline/context';
import { runStep } from '../../../src/core/pipeline/runStep';
import type { SimRuntime } from '../../../src/core/pipeline/runtime';
import { walkTrace } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import type { TraceNode } from '../../../src/core/trace/types';
import type { LedgerEntry } from '../../../src/model/entities/ledger-entry';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  ESTIMATED_CARD_NOTE,
  estimateShowCosts,
  financeSystem,
  LEDGER_ENTRY_TRACE_KIND,
  POST_SHOW_COSTS_SUBSCRIPTION_ID,
  postShowCosts,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
  SHOW_COST_CATEGORIES,
  showWorkersOf,
} from '../../../src/systems/finance';
import { matchSystem } from '../../../src/systems/match';
import { showsSystem } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { showNightWorld } from '../shows/show-night-world';
import { bareRuntime, showCostWorld } from './show-cost-world';

const SOURCE = { kind: 'phase', id: 'test.showCosts' } as const;

function step(runtime: SimRuntime, body: (ctx: StepContext) => void) {
  return runStep(runtime, 'test.showCosts', SOURCE, body);
}

function post(runtime: SimRuntime, eventInstanceId: EventInstanceId) {
  return step(runtime, (ctx) => {
    postShowCosts(ctx, eventInstanceId);
  });
}

function showRows(world: GameWorld, eventInstanceId: EventInstanceId): LedgerEntry[] {
  return world.tables.ledgerEntries
    .values()
    .filter((row) => row.refs.eventInstanceId === eventInstanceId);
}

function cashOf(world: GameWorld, promotionId: PromotionId): number {
  return world.tables.promotions.require(promotionId).cash;
}

function amountsOf(rows: readonly LedgerEntry[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.category, row.amount]));
}

function labelsOf(trace: TraceNode): string[] {
  const labels: string[] = [];
  walkTrace(trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

function storedTrace(runtime: SimRuntime, row: LedgerEntry): TraceNode {
  const stored = row.traceRef === null ? undefined : runtime.traces.get(row.traceRef);
  if (stored === undefined || !isFullTrace(stored)) {
    throw new Error(`no full trace for ${row.id}`);
  }
  return stored.trace;
}

describe('showWorkersOf', () => {
  it('lists every distinct worker once, guests and crew included', () => {
    const built = showCostWorld();
    const instance = built.world.tables.eventInstances.require(built.show);
    const { workers, estimated } = showWorkersOf(built.world, instance, createEngineTunables());
    expect(estimated).toBe(false);
    // Person 0 is in all three matches and is listed once; person 3 only referees.
    expect(workers.map((worker) => worker.personId)).toEqual(
      [...built.roster, built.rivals[0]].sort(),
    );
    const guest = workers.find((worker) => worker.personId === built.rivals[0]);
    expect(guest).toMatchObject({ excluded: 'guest', employmentId: null, perAppearanceFee: 0 });
    expect(workers.filter((worker) => worker.excluded === null)).toHaveLength(4);
  });

  it('leaves out the owner and booker unless they are paid a wage', () => {
    const built = showCostWorld();
    const owner = built.roster[0];
    const result = built.world.transact('owner', (tx) => {
      tx.update('promotions', built.human, { ownerPersonId: owner ?? null });
    });
    expect(result.ok).toBe(true);
    const instance = built.world.tables.eventInstances.require(built.show);
    const excluded = (overrides = {}) =>
      showWorkersOf(built.world, instance, createEngineTunables(overrides)).workers.find(
        (worker) => worker.personId === owner,
      )?.excluded;
    expect(excluded()).toBe('ownerOrBooker');
    expect(excluded({ 'finance.payOwnerAndBooker': true })).toBeNull();
  });

  it('estimates a show with no card from the top of the roster', () => {
    const built = showCostWorld();
    const instance = built.world.tables.eventInstances.require(built.offscreen);
    const { workers, estimated } = showWorkersOf(built.world, instance, createEngineTunables());
    expect(estimated).toBe(true);
    // 3 slots × 2 workers: everyone but the enhancement talent (index 3) and the unpushed (index 7).
    const expected = [0, 1, 2, 4, 5, 6].map((index) => built.rivals[index]);
    expect(workers.map((worker) => worker.personId)).toEqual(expected.sort());
  });
});

describe('postShowCosts', () => {
  it('posts appearance fees, travel and catering, each linked to the show', () => {
    const built = showCostWorld();
    const runtime = bareRuntime(built.world);
    const before = cashOf(built.world, built.human);
    expect(post(runtime, built.show).status).toBe('ok');

    const rows = showRows(built.world, built.show);
    expect(rows.map((row) => row.category).sort()).toEqual([...SHOW_COST_CATEGORIES].sort());
    // Fees: person 1's $400. Travel: three workers at Basic ($50) and the perk at Premium ($500).
    // Catering: Basic, $250. A regular show at home: no multipliers.
    expect(amountsOf(rows)).toEqual({
      appearanceFees: -40_000,
      travel: -65_000,
      catering: -25_000,
    });
    expect(rows.map((row) => row.memo).sort()).toEqual([
      'Test Night: appearance fees',
      'Test Night: catering',
      'Test Night: travel',
    ]);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    expect(cashOf(built.world, built.human) - before).toBe(total);

    const travel = rows.find((row) => row.category === 'travel');
    if (travel === undefined) {
      throw new Error('no travel row');
    }
    expect(travel.traceRef?.kind).toBe(LEDGER_ENTRY_TRACE_KIND);
    const trace = storedTrace(runtime, travel);
    expect(trace.value).toBe(travel.amount);
    expect(labelsOf(trace)).toEqual(
      expect.arrayContaining([
        'Cost',
        'Basic travel per worker',
        'Premium travel per worker',
        '1 guest has no contract here: nothing to pay',
      ]),
    );
  });

  it('posts nothing the second time', () => {
    const built = showCostWorld();
    const runtime = bareRuntime(built.world);
    post(runtime, built.show);
    const cash = cashOf(built.world, built.human);
    const report = post(runtime, built.show);
    expect(report.status).toBe('ok');
    expect(showRows(built.world, built.show)).toHaveLength(3);
    expect(cashOf(built.world, built.human)).toBe(cash);
    expect(report.logs).toContain('Test Night: show costs already posted');
  });

  it('skips a cost that comes to 0', () => {
    const built = showCostWorld({ policies: { catering: 0 } });
    const runtime = bareRuntime(built.world);
    post(runtime, built.show);
    expect(
      showRows(built.world, built.show)
        .map((row) => row.category)
        .sort(),
    ).toEqual(['appearanceFees', 'travel']);
  });

  it('charges travel more away from the home region and more again abroad', () => {
    const travelAt = (showRegion: number) => {
      const built = showCostWorld({ showRegion });
      post(bareRuntime(built.world), built.show);
      return amountsOf(showRows(built.world, built.show))['travel'];
    };
    expect(travelAt(0)).toBe(-65_000);
    expect(travelAt(1)).toBe(-97_500);
    expect(travelAt(2)).toBe(-195_000);
  });

  it('charges a show with no card for the estimated card, under the rival kind', () => {
    const built = showCostWorld();
    const runtime = bareRuntime(built.world);
    post(runtime, built.offscreen);
    const rows = showRows(built.world, built.offscreen);
    // Six estimated workers at Basic travel, Basic catering; nobody on a per-appearance fee.
    expect(amountsOf(rows)).toEqual({ travel: -30_000, catering: -25_000 });
    const travel = rows.find((row) => row.category === 'travel');
    if (travel === undefined) {
      throw new Error('no travel row');
    }
    expect(travel.traceRef?.kind).toBe(RIVAL_LEDGER_ENTRY_TRACE_KIND);
    expect(labelsOf(storedTrace(runtime, travel))).toContain(ESTIMATED_CARD_NOTE);
  });

  it('refuses a show that has not been completed', () => {
    const built = showCostWorld();
    const result = built.world.transact('reopen', (tx) => {
      tx.update('eventInstances', built.show, { status: 'booked', result: null });
    });
    expect(result.ok).toBe(true);
    const report = post(bareRuntime(built.world), built.show);
    expect(report.status).toBe('failed');
    expect(showRows(built.world, built.show)).toEqual([]);
  });
});

describe('estimateShowCosts', () => {
  it('prices a show that is not booked with the same formula, on an average contract', () => {
    const built = showCostWorld();
    const tunables = createEngineTunables();
    // A's four contracts average $100 a show ($400 ÷ 4).
    const abroad = built.regions[2];
    if (abroad === undefined) {
      throw new Error('no region');
    }
    const costs = estimateShowCosts(
      built.world,
      built.human,
      { importance: 'major', regionId: abroad, headcount: 10 },
      tunables,
    );
    expect(costs.appearanceFees.value).toBe(100_000);
    // 10 × $50 × 1.5 (major) × 3 (abroad).
    expect(costs.travel.value).toBe(225_000);
    expect(costs.catering.value).toBe(37_500);
    expect(labelsOf(costs.travel.trace)).toContain(ESTIMATED_CARD_NOTE);
    // Other policy levels on request.
    expect(
      estimateShowCosts(
        built.world,
        built.human,
        { importance: 'regular', regionId: built.regions[0] ?? abroad, headcount: 2 },
        tunables,
        { cateringLevel: 3, travelLevel: 0 },
      ),
    ).toMatchObject({ travel: { value: 0 }, catering: { value: 250_000 } });
  });
});

describe('the finance.postShowCosts reaction', () => {
  it('is registered on show.completed', () => {
    const finance = defaultSystems.find((system) => system.id === 'finance');
    expect(finance?.subscriptions).toEqual([
      expect.objectContaining({ id: POST_SHOW_COSTS_SUBSCRIPTION_ID, type: 'show.completed' }),
    ]);
  });

  it('posts the costs of every show a real show night completes, player and rival', async () => {
    const built = showNightWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: [simSystem, matchSystem, showsSystem, financeSystem],
    });
    await engine.advanceDays({ maxDays: 1 });
    const { world } = engine.exportState();
    const completed = world.tables.eventInstances.filter(
      (instance) => instance.status === 'completed',
    );
    const shows = [built.human, built.rivalCard, ...built.rivalBare];
    for (const id of shows) {
      expect(completed.map((instance) => instance.id)).toContain(id);
    }
    for (const id of shows) {
      if (id === null) {
        continue;
      }
      const rows = world.tables.ledgerEntries.filter((row) => row.refs.eventInstanceId === id);
      expect(
        rows.map((row) => row.category),
        id,
      ).toContain('travel');
      expect(
        rows.map((row) => row.category),
        id,
      ).toContain('catering');
    }
    // Every show-cost row of the player's show has a Why? the player can open.
    const humanRows = world.tables.ledgerEntries.filter(
      (row) => row.refs.eventInstanceId === built.human,
    );
    for (const row of humanRows) {
      const found = engine.query(
        'trace.get',
        { ref: row.traceRef ?? { kind: 'x', id: 'x' } },
        OMNISCIENT_VIEWER,
      );
      expect(found.ok && found.data !== null).toBe(true);
    }
  });
});
