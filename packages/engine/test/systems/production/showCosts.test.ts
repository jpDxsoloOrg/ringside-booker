// Per-show production costs (ECO7-05). Design: docs/design/production.md#per-show-costs
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { EventInstanceId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { runStep } from '../../../src/core/pipeline/runStep';
import type { SimRuntime } from '../../../src/core/pipeline/runtime';
import { walkTrace } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import type { LedgerEntry } from '../../../src/model/entities/ledger-entry';
import type { Production } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import { financeSystem, RIVAL_LEDGER_ENTRY_TRACE_KIND } from '../../../src/systems/finance';
import { matchSystem } from '../../../src/systems/match';
import {
  postShowProductionCost,
  productionSystem,
  SHOW_PRODUCTION_COSTS_SUBSCRIPTION_ID,
} from '../../../src/systems/production';
import { showsSystem } from '../../../src/systems/shows';
import { anEventInstance, withMyShowsRun, worldBuilder } from '../../support';
import { bareRuntime } from '../finance/show-cost-world';
import { runsAllButUnrun, showNightWorld } from '../shows/show-night-world';
import { COMPUTER, PLAYER } from './production-world';
import { HARDPAN, NOTHING } from './support';

/** Hardpan with camera raised to 4: a minor show costs $60 + $4,800 + $50 = $4,910. */
const HARDPAN_CAMERA_4: Production = { ...HARDPAN, camera: 4 };

interface CostWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  /** A's completed minor show "Hardpan Friday". */
  readonly show: EventInstanceId;
  /** B's completed minor show with no card, "Rival Friday". */
  readonly rivalShow: EventInstanceId;
  /** A's cancelled show. */
  readonly cancelled: EventInstanceId;
}

function costWorld(humanLevels: Production = HARDPAN_CAMERA_4): CostWorld {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({
      name: 'Hardpan',
      controller: PLAYER,
      production: humanLevels,
      cash: cents(10_000_000),
    })
    .withPromotion({
      name: 'Rival',
      controller: COMPUTER,
      production: HARDPAN_CAMERA_4,
      cash: cents(10_000_000),
    })
    .with('shows', (context) => {
      const date = context.meta.currentDate;
      const show = (promotionId: PromotionId | undefined, name: string, status: string) => {
        if (promotionId === undefined) throw new Error('no promotion');
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId,
              name,
              importance: 'minor',
              status: status === 'completed' ? 'completed' : 'cancelled',
              date,
            },
            context.sequence,
          ),
        );
      };
      show(context.ids.promotions.A, 'Hardpan Friday', 'completed');
      show(context.ids.promotions.B, 'Rival Friday', 'completed');
      show(context.ids.promotions.A, 'Hardpan Saturday', 'cancelled');
    })
    .build();
  const [show, rivalShow, cancelled] = built.ids.eventInstances;
  const human = built.ids.promotions.A;
  const rival = built.ids.promotions.B;
  if (
    show === undefined ||
    rivalShow === undefined ||
    cancelled === undefined ||
    human === undefined ||
    rival === undefined
  ) {
    throw new Error('costWorld: missing ids');
  }
  return { world: built.world, human, rival, show, rivalShow, cancelled };
}

function post(runtime: SimRuntime, eventInstanceId: EventInstanceId) {
  return runStep(runtime, 'test.showProduction', { kind: 'phase', id: 'test' }, (ctx) => {
    postShowProductionCost(ctx, eventInstanceId);
  });
}

function productionRows(world: GameWorld, eventInstanceId: EventInstanceId): LedgerEntry[] {
  return world.tables.ledgerEntries
    .values()
    .filter((row) => row.category === 'production' && row.refs.eventInstanceId === eventInstanceId);
}

function labelsOf(runtime: SimRuntime, row: LedgerEntry): string[] {
  const stored = row.traceRef === null ? undefined : runtime.traces.get(row.traceRef);
  if (stored === undefined || !isFullTrace(stored)) {
    throw new Error(`no full trace for ${row.id}`);
  }
  const labels: string[] = [];
  walkTrace(stored.trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

describe('postShowProductionCost', () => {
  it('charges a Hardpan-like minor show $4,910, linked to the show, with a line per area', () => {
    const built = costWorld();
    const runtime = bareRuntime(built.world);
    const cash = built.world.tables.promotions.require(built.human).cash;
    expect(post(runtime, built.show).status).toBe('ok');

    const rows = productionRows(built.world, built.show);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (row === undefined) throw new Error('no row');
    expect(row).toMatchObject({
      promotionId: built.human,
      amount: -491_000,
      memo: 'Show production: Hardpan Friday',
      refs: { eventInstanceId: built.show },
    });
    expect(built.world.tables.promotions.require(built.human).cash).toBe(cash - 491_000);
    expect(labelsOf(runtime, row)).toEqual(
      expect.arrayContaining([
        'Hardpan Friday production',
        'Stage at level 1',
        'Camera at level 4',
        'Editing at level 1',
        'Cost',
      ]),
    );
  });

  it("charges a rival's show without a card by the same rule, keeping only a summary", () => {
    const built = costWorld();
    const runtime = bareRuntime(built.world);
    post(runtime, built.rivalShow);
    const [row] = productionRows(built.world, built.rivalShow);
    expect(row).toMatchObject({ promotionId: built.rival, amount: -491_000 });
    expect(row?.traceRef?.kind).toBe(RIVAL_LEDGER_ENTRY_TRACE_KIND);
    const stored = row?.traceRef ? runtime.traces.get(row.traceRef) : undefined;
    expect(stored).toMatchObject({ value: -491_000, summaryOnly: true });
  });

  it('charges a show once, however often it is asked', () => {
    const built = costWorld();
    const runtime = bareRuntime(built.world);
    post(runtime, built.show);
    const report = post(runtime, built.show);
    expect(report.logs).toContain('Hardpan Friday: show production already paid');
    expect(productionRows(built.world, built.show)).toHaveLength(1);
  });

  it('posts nothing for a show with no paid production, or a cancelled show', () => {
    const built = costWorld(NOTHING);
    const runtime = bareRuntime(built.world);
    post(runtime, built.show);
    post(runtime, built.cancelled);
    expect(productionRows(built.world, built.show)).toEqual([]);
    expect(productionRows(built.world, built.cancelled)).toEqual([]);
  });
});

describe('the production.showCosts reaction', () => {
  it('is registered on show.completed', () => {
    const production = defaultSystems.find((system) => system.id === 'production');
    expect(production?.subscriptions).toEqual([
      expect.objectContaining({
        id: SHOW_PRODUCTION_COSTS_SUBSCRIPTION_ID,
        type: 'show.completed',
      }),
    ]);
  });

  it('charges every show a real show night completes, player and rival, once', async () => {
    const built = showNightWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: withMyShowsRun(
        [simSystem, matchSystem, showsSystem, financeSystem, productionSystem],
        runsAllButUnrun,
      ),
    });
    await engine.advanceDays({ maxDays: 1 });
    const { world } = engine.exportState();
    for (const id of [built.human, built.rivalCard, ...built.rivalBare]) {
      if (id === null) continue;
      expect(world.tables.eventInstances.find((show) => show.id === id)?.status, id).toBe(
        'completed',
      );
      const rows = world.tables.ledgerEntries.filter(
        (row) => row.category === 'production' && row.refs.eventInstanceId === id,
      );
      expect(rows, id).toHaveLength(1);
      expect(rows[0]?.amount, id).toBeLessThan(0);
    }
    // The results page's Show money section lists the show's ledger rows: the production row is
    // among them, once, with no second line added anywhere else.
    const human = built.human;
    if (human === null) throw new Error('expected the player show');
    const promotionId = world.tables.eventInstances.find((show) => show.id === human)?.promotionId;
    if (promotionId === undefined) throw new Error('no promotion');
    const ledger = engine.query(
      'finance.ledger',
      { promotionId, eventInstanceId: human },
      { kind: 'omniscient' },
    );
    if (!ledger.ok) throw new Error('finance.ledger refused');
    expect(ledger.data.rows.filter((row) => row.category === 'production')).toHaveLength(1);
  });
});
