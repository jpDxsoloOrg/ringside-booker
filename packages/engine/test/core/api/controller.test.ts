import { describe, expect, it } from 'vitest';
import {
  controlsPromotion,
  createEngine,
  initialEngineState,
  viewerPromotionIds,
  type Viewer,
} from '../../../src/core/api';
import type { Controller } from '../../../src/model/controller';
import { sameController } from '../../../src/systems/calendar/control';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';
import { testId } from '../../support/ids';
import { tinyWorld } from '../../support/worlds';
import { engineFor, testSystems } from './apiTestSystem';

const P1: Controller = { kind: 'human', playerId: 'p1' };
const P2: Controller = { kind: 'human', playerId: 'p2' };
const COMPUTER: Controller = { kind: 'computer' };

/** Two players; promotion A is run by p1, promotion B by the computer. */
function twoPlayerWorld(): BuiltWorld {
  return worldBuilder({
    players: [
      { playerId: 'p1', displayName: 'Player One' },
      { playerId: 'p2', displayName: 'Player Two' },
    ],
  })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: P1 })
    .withPromotion({ name: 'Test Promotion B', controller: COMPUTER })
    .build();
}

describe('the command log', () => {
  it('logs applied, rejected and failed commands with who issued them', () => {
    const { world, ids } = tinyWorld();
    const engine = engineFor(world);
    const promotionId = ids.promotions.A!;
    const human: Controller = { kind: 'human', playerId: 'player-1' };

    engine.command('test.moveCash', { promotionId, amount: 5 }, human);
    engine.command('test.refuse', {}, COMPUTER);
    engine.command('test.explode', { promotionId }, human);
    engine.commandRaw('test.moveCash', { promotionId, amount: 'x' }, COMPUTER);

    const { entries, seq } = engine.exportState().commandLog;
    expect(seq).toBe(4);
    expect(entries).toEqual([
      {
        seq: 1,
        date: world.meta.currentDate,
        issuedBy: human,
        name: 'test.moveCash',
        args: { promotionId, amount: 5 },
        outcome: 'applied',
        reasonCodes: [],
      },
      {
        seq: 2,
        date: world.meta.currentDate,
        issuedBy: COMPUTER,
        name: 'test.refuse',
        args: {},
        outcome: 'rejected',
        reasonCodes: ['notToday'],
      },
      {
        seq: 3,
        date: world.meta.currentDate,
        issuedBy: human,
        name: 'test.explode',
        args: { promotionId },
        outcome: 'failed',
        reasonCodes: ['internal'],
      },
      {
        seq: 4,
        date: world.meta.currentDate,
        issuedBy: COMPUTER,
        name: 'test.moveCash',
        args: { promotionId, amount: 'x' },
        outcome: 'rejected',
        reasonCodes: ['invalidArgs'],
      },
    ]);
    expect(engine.query('sim.commandLog', { limit: 1 }, { kind: 'omniscient' })).toMatchObject({
      ok: true,
      data: [{ seq: 4 }],
    });
  });

  it('keeps only the newest sim.commandLogSize entries', () => {
    const state = initialEngineState(tinyWorld().world);
    const engine = createEngine({
      state: { ...state, tunableOverrides: { 'sim.commandLogSize': 2 } },
      systems: testSystems(),
    });
    for (let index = 0; index < 5; index++) {
      engine.command('test.refuse', {}, COMPUTER);
    }
    const log = engine.exportState().commandLog;
    expect(log.seq).toBe(5);
    expect(log.entries.map((entry) => entry.seq)).toEqual([4, 5]);
  });

  it('keeps nothing at size 0 but still counts', () => {
    const state = initialEngineState(tinyWorld().world);
    const engine = createEngine({
      state: { ...state, tunableOverrides: { 'sim.commandLogSize': 0 } },
      systems: testSystems(),
    });
    engine.command('test.refuse', {}, COMPUTER);
    expect(engine.exportState().commandLog).toEqual({ version: 1, seq: 1, entries: [] });
  });

  it('round-trips through exportState', () => {
    const engine = engineFor(tinyWorld().world);
    engine.command('test.refuse', {}, P1);
    const reloaded = createEngine({ state: engine.exportState(), systems: testSystems() });
    reloaded.command('test.refuse', {}, P2);
    expect(reloaded.exportState().commandLog.entries.map((entry) => entry.issuedBy)).toEqual([
      P1,
      P2,
    ]);
  });
});

describe('viewers', () => {
  it('hands a query the viewer it was called with', () => {
    const engine = engineFor(tinyWorld().world);
    const viewers: Viewer[] = [
      { kind: 'omniscient' },
      { kind: 'controller', controller: P1 },
      { kind: 'controller', controller: COMPUTER },
    ];
    for (const viewer of viewers) {
      expect(engine.query('test.viewer', {}, viewer)).toEqual({ ok: true, data: viewer });
    }
  });

  it('refuses a malformed viewer with invalidArgs reasons', () => {
    const engine = engineFor(tinyWorld().world);
    expect(engine.queryRaw('test.viewer', {}, { kind: 'controller' })).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'invalidArgs', field: 'viewer.controller' })],
    });
    expect(engine.queryRaw('test.viewer', {}, null)).toMatchObject({
      ok: false,
      reasons: [{ code: 'invalidArgs' }],
    });
  });

  it('finds the promotions a human runs from the controller field only', () => {
    const { world, ids } = twoPlayerWorld();
    const promotionA = ids.promotions.A!;
    expect(viewerPromotionIds(world, { kind: 'controller', controller: P1 })).toEqual([promotionA]);
    expect(viewerPromotionIds(world, { kind: 'controller', controller: P2 })).toEqual([]);
    expect(viewerPromotionIds(world, { kind: 'controller', controller: COMPUTER })).toEqual([]);
    expect(viewerPromotionIds(world, { kind: 'omniscient' })).toEqual([]);
  });
});

describe('who may issue commands for a promotion (AIP1-07: one rule)', () => {
  it('lets the same human run their promotion and the computer run its own', () => {
    const { world, ids } = twoPlayerWorld();
    const promotionA = ids.promotions.A!;
    const promotionB = ids.promotions.B!;
    expect(controlsPromotion(world, promotionA, P1)).toBe(true);
    expect(controlsPromotion(world, promotionA, P2)).toBe(false);
    expect(controlsPromotion(world, promotionA, COMPUTER)).toBe(false);
    expect(controlsPromotion(world, promotionB, COMPUTER)).toBe(true);
    expect(controlsPromotion(world, promotionB, P1)).toBe(false);
  });

  it("agrees with the calendar's sameController on every pair", () => {
    const { world, ids } = twoPlayerWorld();
    for (const promotionId of [ids.promotions.A!, ids.promotions.B!]) {
      const owner = world.tables.promotions.require(promotionId).controller;
      for (const issuer of [P1, P2, COMPUTER]) {
        expect(controlsPromotion(world, promotionId, issuer)).toBe(sameController(owner, issuer));
      }
    }
  });

  it('is false for a promotion that is not in the world', () => {
    const { world } = twoPlayerWorld();
    expect(controlsPromotion(world, testId('promotion', 999), COMPUTER)).toBe(false);
  });
});

describe('no special player', () => {
  it('ends in the same world whichever human issues the same commands', async () => {
    const run = async (issuedBy: Controller) => {
      const { world, ids } = twoPlayerWorld();
      const engine = engineFor(world);
      const promotionB = ids.promotions.B!;
      engine.command('test.moveCash', { promotionId: promotionB, amount: 1000 }, issuedBy);
      await engine.advanceDays({ maxDays: 3 });
      engine.command('test.moveCash', { promotionId: ids.promotions.A!, amount: -50 }, issuedBy);
      engine.command(
        'tunables.setOverride',
        { key: 'sim.traceRetentionPerKind', value: 1 },
        issuedBy,
      );
      await engine.advanceDays({ maxDays: 2 });
      return engine.exportState();
    };
    const asP1 = await run(P1);
    const asP2 = await run(P2);
    expect(asP2.world).toStrictEqual(asP1.world);
    expect(asP2.rng).toStrictEqual(asP1.rng);
    expect(asP2.events).toStrictEqual(asP1.events);
    expect(asP2.traces).toStrictEqual(asP1.traces);
    expect(asP2.tunableOverrides).toStrictEqual(asP1.tunableOverrides);
    expect(asP1.commandLog.entries.every((entry) => entry.outcome === 'applied')).toBe(true);
    expect(asP2.commandLog.entries.map((entry) => entry.issuedBy)).toEqual([P2, P2, P2]);
  });
});
