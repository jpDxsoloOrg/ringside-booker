import { describe, expect, it } from 'vitest';
import { addDays, diffDays, weekday } from '../../../src/core/date';
import { NotSerialisableError, PipelineError, RegistryError } from '../../../src/core/errors';
import {
  assertSerialisable,
  createEngine,
  defineQuery,
  defineSystem,
  initialEngineState,
  simSystem,
  type EngineState,
} from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import { z } from 'zod';
import { TINY_WORLD_START, TINY_WORLD_TODAY, tinyWorld } from '../../support/worlds';
import {
  clockDate,
  engineFor,
  TEST_TRACE_KIND,
  testApiSystem,
  testDailySystem,
  testSystems,
  throughJson,
} from './apiTestSystem';

const OMNISCIENT = { kind: 'omniscient' } as const;

/** Runs `days` days and fails the test if the advance stopped early or any step failed. */
async function advance(engine: ReturnType<typeof engineFor>, days: number): Promise<void> {
  const result = await engine.advanceDays({ maxDays: days });
  expect(result.failures).toEqual([]);
  expect(result.daysAdvanced).toBe(days);
}

describe('createEngine and the clock', () => {
  it('starts on the fixture date', () => {
    const engine = engineFor(tinyWorld().world);
    const clock = engine.query('clock.get', {}, OMNISCIENT);
    expect(clock).toEqual({
      ok: true,
      data: {
        date: TINY_WORLD_TODAY,
        weekday: weekday(TINY_WORLD_TODAY),
        dayNumber: diffDays(TINY_WORLD_START, TINY_WORLD_TODAY) + 1,
      },
    });
  });

  it('moves the clock by the days advanced', async () => {
    const engine = engineFor(tinyWorld().world);
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result).toMatchObject({
      startDate: TINY_WORLD_TODAY,
      endDate: addDays(TINY_WORLD_TODAY, 3),
      daysAdvanced: 3,
      stoppedBy: { kind: 'completed' },
      failures: [],
    });
    expect(clockDate(engine)).toBe(addDays(TINY_WORLD_TODAY, 3));
  });

  it('runs with the default systems alone', async () => {
    const engine = createEngine({
      state: initialEngineState(tinyWorld().world),
      systems: defaultSystems,
    });
    await advance(engine, 2);
    expect(clockDate(engine)).toBe(addDays(TINY_WORLD_TODAY, 2));
  });

  it('refuses a state whose RNG seed is not the world seed', () => {
    const state = initialEngineState(tinyWorld().world);
    expect(() =>
      createEngine({ state: { ...state, rng: { ...state.rng, seed: 'other' } }, systems: [] }),
    ).toThrow(PipelineError);
  });

  it('passes the host clock to step timings and the host yield to the advance', async () => {
    let yields = 0;
    let now = 0;
    const engine = createEngine({
      state: initialEngineState(tinyWorld().world),
      systems: testSystems(),
      host: {
        now: () => (now += 5),
        yieldToHost: () => {
          yields += 1;
          return Promise.resolve();
        },
      },
    });
    const result = await engine.advanceDays({ maxDays: 4 });
    expect(yields).toBe(4);
    expect(result.timing.ms).toBeGreaterThan(0);
  });
});

describe('exportState', () => {
  it('round-trips through JSON and createEngine unchanged', async () => {
    const { world, ids } = tinyWorld();
    const engine = engineFor(world);
    await advance(engine, 5);
    const promotionId = ids.promotions.A!;
    expect(
      engine.command('test.moveCash', { promotionId, amount: 100 }, { kind: 'computer' }).ok,
    ).toBe(true);
    expect(engine.command('test.refuse', {}, { kind: 'computer' }).ok).toBe(false);
    expect(
      engine.command(
        'tunables.setOverride',
        { key: 'sim.traceRetentionPerKind', value: 3 },
        { kind: 'human', playerId: 'player-1' },
      ).ok,
    ).toBe(true);

    const exported = engine.exportState();
    expect(() => {
      assertSerialisable(exported, 'state');
    }).not.toThrow();
    expect(exported.events.recent.length).toBeGreaterThan(0);
    expect(exported.traces.full.length).toBeGreaterThan(0);
    expect(exported.commandLog.entries.length).toBe(3);
    expect(exported.tunableOverrides).toEqual({ 'sim.traceRetentionPerKind': 3 });

    const reloaded = createEngine({ state: throughJson(exported), systems: testSystems() });
    expect(reloaded.exportState()).toStrictEqual(throughJson(exported));
  });

  it('continues identically after a reload', async () => {
    const original = engineFor(tinyWorld().world);
    await advance(original, 7);
    const reloaded = createEngine({
      state: throughJson(original.exportState()),
      systems: testSystems(),
    });

    await advance(original, 10);
    await advance(reloaded, 10);

    const left = original.exportState();
    const right = reloaded.exportState();
    expect(right).toStrictEqual(left);
    // The run did real work: news rows were minted, traces kept, events logged.
    expect(left.world.tables.news.length).toBe(17 + tinyWorld().world.tables.news.size);
    expect(left.traces.full.some((entry) => entry.ref.kind === TEST_TRACE_KIND)).toBe(true);
    expect(Object.keys(left.rng.streams)).toContain('test.api');
  });

  it('gives the same results as a fresh engine for the same seed and inputs', async () => {
    const first = engineFor(tinyWorld().world);
    const second = engineFor(tinyWorld().world);
    await advance(first, 6);
    await advance(second, 6);
    expect(second.exportState()).toStrictEqual(first.exportState());
  });
});

describe('onEvent', () => {
  it('sees every committed event until it unsubscribes', async () => {
    const engine = engineFor(tinyWorld().world);
    const seen: AnyDomainEvent[] = [];
    const unsubscribe = engine.onEvent((event) => {
      seen.push(event);
    });
    await advance(engine, 1);
    expect(seen.map((event) => event.type)).toEqual(['day.started', 'test.dayTicked', 'day.ended']);
    unsubscribe();
    await advance(engine, 1);
    expect(seen).toHaveLength(3);
  });
});

describe('advanceDays', () => {
  it('refuses commands and a second advance while one is running', async () => {
    const { world, ids } = tinyWorld();
    let release: () => void = () => undefined;
    const engine = createEngine({
      state: initialEngineState(world),
      systems: testSystems(),
      host: {
        yieldToHost: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    const running = engine.advanceDays({ maxDays: 1 });
    await expect(engine.advanceDays({ maxDays: 1 })).rejects.toThrow(PipelineError);
    const refused = engine.command(
      'test.moveCash',
      { promotionId: ids.promotions.A!, amount: 1 },
      { kind: 'computer' },
    );
    expect(refused).toEqual({ ok: false, reasons: [expect.objectContaining({ code: 'busy' })] });
    expect(engine.query('clock.get', {}, OMNISCIENT).ok).toBe(true);
    release();
    await running;
    expect(
      engine.command(
        'test.moveCash',
        { promotionId: ids.promotions.A!, amount: 1 },
        { kind: 'computer' },
      ).ok,
    ).toBe(true);
  });

  it('rejects options the advance loop cannot run with', async () => {
    const engine = engineFor(tinyWorld().world);
    await expect(engine.advanceDays({ maxDays: 0 })).rejects.toThrow(RangeError);
    // The guard is released after a rejected advance.
    await advance(engine, 1);
  });
});

describe('serialisability checks', () => {
  it('catches a Map in a query result in debug mode and names the path', () => {
    const engine = engineFor(tinyWorld().world);
    const result = engine.query('test.mapResult', {}, OMNISCIENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]?.code).toBe('internal');
      expect(result.reasons[0]?.message).toContain('queries["test.mapResult"].lookup');
      expect(result.reasons[0]?.message).toContain('Map');
    }
    expect(() => {
      assertSerialisable({ lookup: new Map() }, 'result');
    }).toThrow(NotSerialisableError);
  });

  it('skips the check when debug checks are off', () => {
    const engine = createEngine({
      state: initialEngineState(tinyWorld().world),
      systems: testSystems(),
      debugChecks: false,
    });
    expect(engine.debugChecks).toBe(false);
    expect(engine.query('test.mapResult', {}, OMNISCIENT).ok).toBe(true);
  });

  it('turns a query that throws into an internal reason', () => {
    const engine = engineFor(tinyWorld().world);
    expect(engine.query('test.throws', {}, OMNISCIENT)).toEqual({
      ok: false,
      reasons: [
        { code: 'internal', message: expect.stringContaining('The query blew up') as unknown },
      ],
    });
  });
});

describe('registration', () => {
  function state(): EngineState {
    return initialEngineState(tinyWorld().world);
  }

  it('throws when two bundles declare the same query, naming both systems', () => {
    const copy = defineSystem({
      id: 'copycat',
      queries: [defineQuery('test.viewer', { args: z.strictObject({}), run: (ctx) => ctx.viewer })],
    });
    expect(() =>
      createEngine({ state: state(), systems: [simSystem, testApiSystem, copy] }),
    ).toThrow('System "copycat": query "test.viewer" is already registered by system "testApi"');
  });

  it('throws for duplicate phases, subscriptions and system ids', () => {
    const phaseCopy = defineSystem({ id: 'phaseCopy', phases: testDailySystem.phases });
    expect(() => createEngine({ state: state(), systems: [testDailySystem, phaseCopy] })).toThrow(
      'System "phaseCopy": phase "testDaily.tick" is already registered by system "testDaily"',
    );
    const subscriptionCopy = defineSystem({
      id: 'subscriptionCopy',
      subscriptions: testDailySystem.subscriptions,
    });
    expect(() =>
      createEngine({ state: state(), systems: [testDailySystem, subscriptionCopy] }),
    ).toThrow('subscription "testDaily.onTick" is already registered');
    expect(() => createEngine({ state: state(), systems: [simSystem, simSystem] })).toThrow(
      'System "sim" is registered twice',
    );
  });

  it('names the system when a phase or gate is malformed', () => {
    const badGate = defineSystem({
      id: 'badGate',
      gates: [{ id: 'sim.mine', label: 'Mine', check: () => null }],
    });
    expect(() => createEngine({ state: state(), systems: [badGate] })).toThrow(RegistryError);
    expect(() => createEngine({ state: state(), systems: [badGate] })).toThrow(
      /^System "badGate": Gate sim\.mine: the "sim\." prefix is reserved/,
    );
  });

  it('rejects malformed system ids and query names when they are defined', () => {
    expect(() => defineSystem({ id: 'Not ok' })).toThrow(RegistryError);
    // @ts-expect-error: not a declared query name
    expect(() => defineQuery('bad', { args: z.strictObject({}), run: () => null })).toThrow(
      RegistryError,
    );
  });
});

describe('typing', () => {
  it('makes unknown names and wrong argument shapes compile errors', () => {
    const engine = engineFor(tinyWorld().world);
    // @ts-expect-error: no such query
    const unknown = engine.query('nope.nothing', {}, OMNISCIENT);
    // @ts-expect-error: limit must be a number
    const wrongArgs = engine.query('sim.failures', { limit: 'ten' }, OMNISCIENT);
    expect(unknown).toEqual({
      ok: false,
      reasons: [{ code: 'unknownQuery', message: 'There is no query called "nope.nothing".' }],
    });
    expect(wrongArgs.ok).toBe(false);
  });
});
