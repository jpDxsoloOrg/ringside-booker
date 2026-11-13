// finance.setPolicy (ECO1-04). Design: docs/design/finances.md#policies
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { Controller } from '../../../src/model/controller';
import { simSystem } from '../../../src/core/api/builtins';
import type { PromotionId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import type { PolicyArea } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import { financeSystem, setPolicyIn, type PolicyLevel } from '../../../src/systems/finance';
import { TEST_PLAYER_ID, testId } from '../../support';
import { payrollWorld } from './payroll-world';
import { bareRuntime, showCostWorld } from './show-cost-world';

const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const OTHER_PLAYER: Controller = { kind: 'human', playerId: 'player-2' };
const COMPUTER: Controller = { kind: 'computer' };

function engineOver(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: [simSystem, financeSystem] });
}

function setPolicy(
  engine: Engine,
  promotionId: PromotionId,
  area: PolicyArea,
  level: PolicyLevel,
  issuedBy: Controller = PLAYER,
) {
  return engine.command('finance.setPolicy', { promotionId, area, level }, issuedBy);
}

function policiesOf(engine: Engine, promotionId: PromotionId) {
  const promotion = engine
    .exportState()
    .world.tables.promotions.find((row) => row.id === promotionId);
  return promotion?.policies;
}

function expectRefused(
  engine: Engine,
  promotionId: PromotionId,
  area: PolicyArea,
  level: PolicyLevel,
  issuedBy: Controller,
  code: string,
  message?: string,
): void {
  const before = engine.exportState();
  const result = setPolicy(engine, promotionId, area, level, issuedBy);
  expect(result).toEqual({
    ok: false,
    reasons: [expect.objectContaining(message === undefined ? { code } : { code, message })],
  });
  expect(engine.exportState().world).toEqual(before.world);
}

describe('finance.setPolicy', () => {
  it("changes the player's policy, publishes finance.policyChanged and says what changed", () => {
    const built = showCostWorld();
    const engine = engineOver(built.world);
    const result = setPolicy(engine, built.human, 'catering', 3);
    expect(result).toMatchObject({ ok: true, data: { area: 'catering', from: 1, to: 3 } });
    expect(policiesOf(engine, built.human)).toEqual({ travel: 1, catering: 3, medical: 0 });
    const events = engine.query(
      'sim.recentEvents',
      { limit: 10, types: ['finance.policyChanged'] },
      { kind: 'omniscient' },
    );
    expect(events.ok && events.data.map((event) => event.payload)).toEqual([
      { promotionId: built.human, area: 'catering', from: 1, to: 3 },
    ]);
  });

  it("refuses a rival's promotion to the player, and the player's to anyone else", () => {
    const built = showCostWorld();
    const engine = engineOver(built.world);
    for (const issuedBy of [PLAYER, OTHER_PLAYER]) {
      expectRefused(engine, built.rival, 'travel', 3, issuedBy, 'notYourPromotion');
    }
    for (const issuedBy of [OTHER_PLAYER, COMPUTER]) {
      expectRefused(engine, built.human, 'travel', 3, issuedBy, 'notYourPromotion');
    }
  });

  it('lets the computer set the policies of a promotion it runs (AIP1-07: one controller rule)', () => {
    const built = showCostWorld();
    const engine = engineOver(built.world);
    const result = setPolicy(engine, built.rival, 'travel', 3, COMPUTER);
    expect(result).toMatchObject({ ok: true, data: { area: 'travel', to: 3 } });
    expect(policiesOf(engine, built.rival)?.travel).toBe(3);
  });

  it('refuses the level the policy already has', () => {
    const built = showCostWorld({ policies: { medical: 2 } });
    expectRefused(
      engineOver(built.world),
      built.human,
      'medical',
      2,
      PLAYER,
      'samePolicy',
      'Medical is already Good',
    );
  });

  it('refuses a closed promotion and an unknown one', () => {
    const built = showCostWorld();
    const closed = built.world.transact('close', (tx) => {
      tx.update('promotions', built.human, { status: 'closed' });
    });
    expect(closed.ok).toBe(true);
    const engine = engineOver(built.world);
    expectRefused(engine, built.human, 'travel', 3, PLAYER, 'promotionClosed');
    expectRefused(engine, testId('promotion', 9_999), 'travel', 3, PLAYER, 'notFound');
  });

  it('is followed by the next 1st: medical at the new level, and no row at None', async () => {
    const premium = payrollWorld('2026-01-31');
    const premiumEngine = engineOver(premium.world);
    expect(setPolicy(premiumEngine, premium.human, 'medical', 3).ok).toBe(true);
    await premiumEngine.advanceDays({ maxDays: 2 });
    // Three people under contract (the booker and the person on leave included), $1,500 each.
    expect(
      premiumEngine
        .exportState()
        .world.tables.ledgerEntries.filter(
          (row) => row.promotionId === premium.human && row.category === 'medical',
        ),
    ).toEqual([expect.objectContaining({ amount: -450_000, memo: 'Medical (Premium)' })]);

    const none = payrollWorld('2026-01-31');
    const noneEngine = engineOver(none.world);
    expect(setPolicy(noneEngine, none.human, 'medical', 0).ok).toBe(true);
    await noneEngine.advanceDays({ maxDays: 2 });
    expect(
      noneEngine
        .exportState()
        .world.tables.ledgerEntries.filter(
          (row) => row.promotionId === none.human && row.category === 'medical',
        ),
    ).toEqual([]);
  });
});

describe('setPolicyIn', () => {
  it("changes a rival's policy without a controller check, and does nothing for the same level", () => {
    const built = showCostWorld();
    const runtime = bareRuntime(built.world);
    const report = runStep(
      runtime,
      'test.setPolicy',
      { kind: 'phase', id: 'test.setPolicy' },
      (ctx) => {
        expect(setPolicyIn(ctx, built.rival, 'travel', 0)).toEqual({
          area: 'travel',
          from: 1,
          to: 0,
        });
        expect(setPolicyIn(ctx, built.rival, 'medical', 1)).toEqual({
          area: 'medical',
          from: 1,
          to: 1,
        });
      },
    );
    expect(report.status).toBe('ok');
    expect(report.eventsPublished).toBe(1);
    expect(built.world.tables.promotions.require(built.rival).policies).toEqual({
      travel: 0,
      catering: 1,
      medical: 1,
    });
  });
});
