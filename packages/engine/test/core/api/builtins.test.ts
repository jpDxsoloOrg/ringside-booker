import { describe, expect, it } from 'vitest';
import {
  assertSerialisable,
  createEngine,
  defineSystem,
  initialEngineState,
  simSystem,
  type Engine,
} from '../../../src/core/api';
import { addDays } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import type { GateSpec } from '../../../src/core/pipeline/gates';
import type { Controller } from '../../../src/model/controller';
import { seasonEndDate, TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { testId } from '../../support/ids';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';
import { clockDate, testSystems } from './apiTestSystem';

const HUMAN: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const OMNISCIENT = { kind: 'omniscient' } as const;
const HOME_REGION = testId('region', 1);

/** One human-run promotion with popularity in its home region, a computer rival, one season. */
function statusWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({
      name: 'Test Promotion A',
      controller: HUMAN,
      homeRegionId: HOME_REGION,
      regionalPop: { [HOME_REGION]: 42 },
      prestige: 61,
      cash: cents(123_456),
    })
    .withPromotion({ name: 'Test Promotion B', controller: { kind: 'computer' } })
    .build();
}

/** A gate that hits on one date. */
function gateOn(date: string): GateSpec {
  return {
    id: 'testGates.showDay',
    label: 'Show needs booking',
    check: (_view, today) =>
      today === date
        ? {
            gateId: 'testGates.showDay',
            reason: 'Your show today has no card yet',
            subject: { kind: 'promotion', id: testId('promotion', 1) },
            actionHint: 'booking',
          }
        : null,
  };
}

function statusEngine(extraSystems = defineSystem({ id: 'none' })): Engine {
  return createEngine({
    state: initialEngineState(statusWorld().world),
    systems: [...testSystems(), extraSystems],
  });
}

describe('sim.status', () => {
  it('shows a human their promotion, its home popularity and the season', () => {
    const engine = statusEngine();
    const status = engine.query('sim.status', {}, { kind: 'controller', controller: HUMAN });
    expect(status).toEqual({
      ok: true,
      data: {
        date: TEST_START_DATE,
        season: { number: 1, endDate: seasonEndDate(TEST_START_DATE) },
        promotion: {
          promotionId: testId('promotion', 1),
          name: 'Test Promotion A',
          cash: 123_456,
          popularity: { homeRegionId: HOME_REGION, homeRegion: 42, prestige: 61, traceRef: null },
        },
      },
    });
    expect(() => {
      assertSerialisable(status, 'status');
    }).not.toThrow();
  });

  it('has no promotion for the omniscient viewer, the computer or a human without one', () => {
    const engine = statusEngine();
    for (const viewer of [
      OMNISCIENT,
      { kind: 'controller', controller: { kind: 'computer' } },
      { kind: 'controller', controller: { kind: 'human', playerId: 'someone-else' } },
    ] as const) {
      const status = engine.query('sim.status', {}, viewer);
      expect(status).toMatchObject({ ok: true, data: { promotion: null, season: { number: 1 } } });
    }
  });

  it('reads home popularity as 0 when the region has none, and no season before season 1', () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .withPromotion({ controller: HUMAN })
      .withoutSeason()
      .build();
    const engine = createEngine({ state: initialEngineState(world), systems: [simSystem] });
    expect(engine.query('sim.status', {}, { kind: 'controller', controller: HUMAN })).toMatchObject(
      {
        ok: true,
        data: { season: null, promotion: { popularity: { homeRegion: 0 } } },
      },
    );
  });
});

describe('sim.pendingGates', () => {
  it("returns today's gate hits without advancing", () => {
    const engine = statusEngine(
      defineSystem({ id: 'testGates', gates: [gateOn(TEST_START_DATE)] }),
    );
    const pending = engine.query('sim.pendingGates', {}, OMNISCIENT);
    expect(pending).toEqual({
      ok: true,
      data: {
        date: TEST_START_DATE,
        hits: [
          {
            gateId: 'testGates.showDay',
            reason: 'Your show today has no card yet',
            subject: { kind: 'promotion', id: testId('promotion', 1) },
            actionHint: 'booking',
          },
        ],
      },
    });
    expect(() => {
      assertSerialisable(pending, 'pending');
    }).not.toThrow();
    expect(clockDate(engine)).toBe(TEST_START_DATE);
    expect(engine.query('sim.pendingGates', {}, OMNISCIENT)).toEqual(pending);
  });

  it('agrees with the advance, which stops on the same hit', async () => {
    const hitDate = addDays(TEST_START_DATE, 2);
    const engine = statusEngine(defineSystem({ id: 'testGates', gates: [gateOn(hitDate)] }));
    expect(engine.query('sim.pendingGates', {}, OMNISCIENT)).toMatchObject({
      ok: true,
      data: { hits: [] },
    });
    const result = await engine.advanceDays({ maxDays: 10 });
    expect(result.daysAdvanced).toBe(2);
    expect(result.stoppedBy).toMatchObject({
      kind: 'gate',
      hits: [{ gateId: 'testGates.showDay' }],
    });
    expect(engine.query('sim.pendingGates', {}, OMNISCIENT)).toMatchObject({
      ok: true,
      data: { date: hitDate, hits: [{ gateId: 'testGates.showDay' }] },
    });
  });
});

describe('reports, events, failures and traces', () => {
  it('serves the last day report, recent events and traces', async () => {
    const engine = statusEngine();
    expect(engine.query('sim.lastDayReport', {}, OMNISCIENT)).toEqual({ ok: true, data: null });
    await engine.advanceDays({ maxDays: 2 });
    const report = engine.query('sim.lastDayReport', {}, OMNISCIENT);
    expect(report).toMatchObject({ ok: true, data: { date: addDays(TEST_START_DATE, 1) } });

    expect(engine.query('sim.recentEvents', { limit: 2 }, OMNISCIENT)).toMatchObject({
      ok: true,
      data: [{ type: 'test.dayTicked' }, { type: 'day.ended' }],
    });
    const ticks = engine.query(
      'sim.recentEvents',
      { limit: 10, types: ['test.dayTicked'] },
      OMNISCIENT,
    );
    expect(ticks.ok && ticks.data.map((event) => event.payload)).toEqual([
      { date: TEST_START_DATE },
      { date: addDays(TEST_START_DATE, 1) },
    ]);
    expect(engine.query('sim.recentEvents', { limit: 0 }, OMNISCIENT)).toEqual({
      ok: true,
      data: [],
    });
    expect(engine.query('sim.failures', { limit: 10 }, OMNISCIENT)).toEqual({ ok: true, data: [] });

    const trace = engine.query(
      'trace.get',
      { ref: { kind: 'test.dailyCash', id: testId('promotion', 1) } },
      OMNISCIENT,
    );
    expect(trace).toMatchObject({ ok: true, data: { date: addDays(TEST_START_DATE, 1) } });
    expect(
      engine.query('trace.get', { ref: { kind: 'test.dailyCash', id: 'nobody' } }, OMNISCIENT),
    ).toEqual({ ok: true, data: null });
    expect(
      engine.queryRaw('trace.get', { ref: { kind: 'Bad Kind', id: 'x' } }, OMNISCIENT),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: 'invalidArgs', field: 'ref.kind' }],
    });
  });
});

describe('tunables', () => {
  it('sets an override of 0 and lists it as overridden', () => {
    const engine = statusEngine();
    const result = engine.command(
      'tunables.setOverride',
      { key: 'sim.traceRetentionPerKind', value: 0 },
      HUMAN,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { key: 'sim.traceRetentionPerKind', value: 0 },
      events: [{ type: 'tunables.changed' }],
    });
    const list = engine.query('tunables.list', { category: 'Simulation' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.find((row) => row.key === 'sim.traceRetentionPerKind')).toMatchObject({
      value: 0,
      default: 200,
      overridden: true,
    });
    expect(list.data.every((row) => row.category === 'Simulation')).toBe(true);
    expect(engine.exportState().tunableOverrides).toEqual({ 'sim.traceRetentionPerKind': 0 });
    expect(engine.query('sim.recentEvents', { limit: 1 }, OMNISCIENT)).toMatchObject({
      ok: true,
      data: [{ type: 'tunables.changed', payload: { key: 'sim.traceRetentionPerKind', value: 0 } }],
    });
  });

  it('applies a new override to the stores straight away', async () => {
    const engine = statusEngine();
    engine.command('tunables.setOverride', { key: 'sim.traceRetentionPerKind', value: 0 }, HUMAN);
    engine.command('tunables.setOverride', { key: 'sim.commandLogSize', value: 1 }, HUMAN);
    await engine.advanceDays({ maxDays: 1 });
    const state = engine.exportState();
    expect(state.traces.full).toEqual([]);
    expect(state.traces.summaries.length).toBeGreaterThan(0);
    expect(state.commandLog.entries).toHaveLength(1);
  });

  it('rejects an out-of-range value with the aboveMax message', () => {
    const engine = statusEngine();
    const result = engine.command(
      'tunables.setOverride',
      { key: 'sim.traceRetentionPerKind', value: 999_999 },
      HUMAN,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        {
          code: 'aboveMax',
          field: 'value',
          message: 'Tunable "sim.traceRetentionPerKind" must be at most 5000, got 999999.',
        },
      ],
    });
    expect(engine.exportState().tunableOverrides).toEqual({});
  });

  it('rejects unknown keys and the computer in a game with players', () => {
    const engine = statusEngine();
    expect(
      engine.command('tunables.setOverride', { key: 'sim.nothing', value: 1 }, HUMAN),
    ).toMatchObject({ ok: false, reasons: [{ code: 'unknownKey', field: 'key' }] });
    expect(
      engine.command(
        'tunables.setOverride',
        { key: 'sim.eventLogSize', value: 10 },
        { kind: 'computer' },
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notAllowed' }] });
    expect(
      engine.command(
        'tunables.setOverride',
        { key: 'sim.eventLogSize', value: 10 },
        { kind: 'human', playerId: 'stranger' },
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notAllowed' }] });
  });

  it('lets any controller change tunables in a world with no players', () => {
    const { world } = worldBuilder({ players: [] }).withoutSeason().build();
    const engine = createEngine({ state: initialEngineState(world), systems: [simSystem] });
    expect(
      engine.command(
        'tunables.setOverride',
        { key: 'sim.eventLogSize', value: 10 },
        {
          kind: 'computer',
        },
      ).ok,
    ).toBe(true);
  });

  it('clears an override back to the default', () => {
    const engine = statusEngine();
    engine.command('tunables.setOverride', { key: 'sim.eventLogSize', value: 10 }, HUMAN);
    const cleared = engine.command('tunables.clearOverride', { key: 'sim.eventLogSize' }, HUMAN);
    expect(cleared).toMatchObject({
      ok: true,
      data: { key: 'sim.eventLogSize', value: null },
      events: [{ type: 'tunables.changed' }],
    });
    expect(engine.exportState().tunableOverrides).toEqual({});
    // Clearing a key that is not overridden changes nothing and publishes nothing.
    expect(
      engine.command('tunables.clearOverride', { key: 'sim.eventLogSize' }, HUMAN),
    ).toMatchObject({ ok: true, events: [] });
    expect(engine.command('tunables.clearOverride', { key: 'sim.nothing' }, HUMAN)).toMatchObject({
      ok: false,
      reasons: [{ code: 'unknownKey' }],
    });
  });

  it('loads a state with an unknown override key and reports it', () => {
    const state = initialEngineState(statusWorld().world);
    const engine = createEngine({
      state: {
        ...state,
        tunableOverrides: { 'sim.removedLongAgo': 3, 'sim.eventLogSize': 20 },
      },
      systems: [simSystem],
    });
    expect(engine.loadIssues).toEqual([
      expect.objectContaining({ key: 'sim.removedLongAgo', problem: 'unknownKey' }),
    ]);
    expect(engine.exportState().tunableOverrides).toEqual({ 'sim.eventLogSize': 20 });
  });
});
