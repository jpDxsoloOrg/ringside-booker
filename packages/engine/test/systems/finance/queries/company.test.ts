// The public company query. Design: docs/design/finances.md#reach-and-size
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import type { PromotionId } from '../../../../src/core/ids';
import { definePhase } from '../../../../src/core/pipeline/phase';
import type { Promotion } from '../../../../src/model/entities/promotion';
import type { GameWorld } from '../../../../src/model/tables';
import {
  financeSystem,
  PROMOTION_SIZES,
  reachOf,
  type CompanyView,
} from '../../../../src/systems/finance';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { applyPopularityChange, workersSystem } from '../../../../src/systems/workers';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { testId } from '../../../support/ids';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
const BYSTANDER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-nobody' },
};
const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };
const OMNISCIENT: Viewer = { kind: 'omniscient' };
const EVERY_VIEWER: readonly Viewer[] = [PLAYER, BYSTANDER, COMPUTER, OMNISCIENT];

interface CompanyWorld {
  world: GameWorld;
  own: PromotionId;
  rival: PromotionId;
}

/**
 * The mini map with a human-run promotion A (with `ownPopularity`, when given) and a computer-run
 * rival B.
 */
function companyWorld(ownPopularity?: Promotion['regionalPop']): CompanyWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({
      name: 'Test Promotion A',
      controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      ...(ownPopularity === undefined ? {} : { regionalPop: ownPopularity }),
    })
    .withPromotion({ name: 'Test Promotion B' })
    .build();
  const own = ids.promotions.A;
  const rival = ids.promotions.B;
  if (own === undefined || rival === undefined) {
    throw new Error('The company world should have two promotions');
  }
  return { world, own, rival };
}

function engineFor(world: GameWorld, extra: Parameters<typeof defineSystem>[0][] = []): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem, financeSystem, ...extra.map((spec) => defineSystem(spec))],
  });
}

function company(engine: Engine, promotionId: PromotionId, viewer: Viewer = PLAYER): CompanyView {
  const result = engine.query('finance.company', { promotionId }, viewer);
  if (!result.ok) {
    throw new Error(`finance.company refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

describe('finance.company', () => {
  it("is public: every viewer reads any promotion's company, and gets the same answer", () => {
    const { world, own, rival } = companyWorld();
    const engine = engineFor(world);
    for (const promotionId of [own, rival]) {
      const answers = EVERY_VIEWER.map((viewer) => company(engine, promotionId, viewer));
      for (const answer of answers) {
        expect(answer).toEqual(answers[0]);
      }
    }
    const view = company(engine, rival, PLAYER);
    expectSerialisable(view);
    expect(view.promotionId).toBe(rival);
    expect(view.name).toBe('Test Promotion B');
    expect(PROMOTION_SIZES).toContain(view.size);
  });

  it('matches reachOf, with both traces inline and no money figures', () => {
    const { world, rival } = companyWorld();
    const engine = engineFor(world);
    const view = company(engine, rival, COMPUTER);
    const direct = reachOf(world, rival, createEngineTunables());
    expect(view.reach).toBe(direct.reach.value);
    expect(view.reachTrace).toEqual(direct.reach.trace);
    expect(view.size).toBe(direct.size.value);
    expect(view.sizeTrace).toEqual(direct.size.trace);
    expect(Object.keys(view).sort()).toEqual([
      'name',
      'nextSize',
      'promotionId',
      'reach',
      'reachTrace',
      'size',
      'sizeLabel',
      'sizeTrace',
    ]);
  });

  it('names the next size up and where it starts, and none past Global', () => {
    const regions = companyWorld().world.tables.regions.values();
    const everywhere = companyWorld(Object.fromEntries(regions.map((row) => [row.id, 100])));
    const top = company(engineFor(everywhere.world), everywhere.own);
    expect(top.size).toBe('global');
    expect(top.sizeLabel).toBe('Global');
    expect(top.nextSize).toBeNull();

    const nowhere = companyWorld({});
    const bottom = company(engineFor(nowhere.world), nowhere.own);
    expect(bottom.reach).toBe(0);
    expect(bottom.size).toBe('local');
    expect(bottom.nextSize).toEqual({ size: 'regional', label: 'Regional', at: 6 });
  });

  it('refuses an unknown promotion with unknownPromotion', () => {
    const { world } = companyWorld();
    const result = engineFor(world).query(
      'finance.company',
      { promotionId: testId('promotion', 9999) },
      BYSTANDER,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual([
      'unknownPromotion',
    ]);
  });

  it('shows a popularity rise on the next query (nothing is cached)', async () => {
    const { world, rival } = companyWorld();
    const homeRegionId = world.tables.promotions.get(rival)?.homeRegionId;
    if (homeRegionId === undefined) {
      throw new Error('missing promotion');
    }
    const engine = engineFor(world, [
      {
        id: 'companyTest',
        phases: [
          definePhase({
            id: 'companyTest.raise',
            group: 'housekeeping',
            order: 10,
            cadence: { kind: 'daily' },
            run: (ctx) => {
              applyPopularityChange(ctx, {
                subject: { kind: 'promotion', id: rival },
                regionWeights: { [homeRegionId]: 1 },
                delta: 10,
                source: 'system',
                reason: { key: 'test.raise', label: 'Test raise' },
              });
            },
          }),
        ],
      },
    ]);
    const before = company(engine, rival, PLAYER);
    const advance = await engine.advanceDays({ maxDays: 1 });
    expect(advance.failures).toEqual([]);
    const after = company(engine, rival, PLAYER);
    expect(after.reach).toBeGreaterThan(before.reach);
  });
});
