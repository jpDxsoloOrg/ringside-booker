// Daily fatigue recovery, run through the engine. Design: docs/design/calculation-traces.md#worked-example
import { describe, expect, it } from 'vitest';
import {
  assertSerialisable,
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
  type SystemBundle,
} from '../../../src/core/api';
import type { PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { intBetween } from '../../../src/core/rng/odds';
import { RngRegistry } from '../../../src/core/rng/registry';
import { replayTrace } from '../../../src/core/trace/replay';
import { isFullTrace, type StoredTraceEntry } from '../../../src/core/trace/store';
import { defaultSystems } from '../../../src/systems';
import { fatigueRecoveryTraceRef } from '../../../src/systems/condition';
import { RECOVERY_STREAM } from '../../../src/systems/condition/streams';
import type { GameWorld } from '../../../src/model/tables';
import { aPerson, TEST_PLAYER_ID, testId, worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';

const OMNISCIENT = { kind: 'omniscient' } as const;

/** Fatigue of the three people in the test world, in ID order. */
const STARTING_FATIGUE = [0, 2, 40] as const;

interface FatigueWorld {
  world: GameWorld;
  /** The people, in the order of {@link STARTING_FATIGUE}. */
  people: readonly [PersonId, PersonId, PersonId];
}

function fatigueWorld(): FatigueWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .with('three people with different fatigue', (context) => {
      for (const fatigue of STARTING_FATIGUE) {
        context.insert('people', aPerson({ fatigue }, context.sequence));
      }
    })
    .build();
  const [rested, nearlyRested, tired] = ids.people;
  if (rested === undefined || nearlyRested === undefined || tired === undefined) {
    throw new Error('the fatigue world should have three people');
  }
  return { world, people: [rested, nearlyRested, tired] };
}

function engineOver(world: GameWorld, systems: readonly SystemBundle[] = defaultSystems): Engine {
  return createEngine({ state: initialEngineState(world), systems });
}

function fatigueOf(engine: Engine, personId: PersonId): number {
  const result = engine.query('condition.fatigue', { personId }, OMNISCIENT);
  if (!result.ok || result.data === null) {
    throw new Error(`condition.fatigue failed for ${personId}: ${JSON.stringify(result)}`);
  }
  return result.data.fatigue;
}

function storedTrace(engine: Engine, personId: PersonId): StoredTraceEntry | null {
  const result = engine.query('trace.get', { ref: fatigueRecoveryTraceRef(personId) }, OMNISCIENT);
  if (!result.ok) {
    throw new Error(`trace.get failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function clearedEvents(engine: Engine): unknown[] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 100, types: ['condition.fatigueCleared'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.map((event) => event.payload);
}

describe('condition.fatigueRecovery phase', () => {
  it('lowers fatigue for one day: 0 stays 0, 2 clears, 40 drops by 4 or 5', async () => {
    const { world, people } = fatigueWorld();
    const [rested, nearlyRested, tired] = people;
    const engine = engineOver(world);

    const result = await engine.advanceDays({ maxDays: 1 });

    expect(result.failures).toEqual([]);
    expect(result.daysAdvanced).toBe(1);
    expect(fatigueOf(engine, rested)).toBe(0);
    expect(fatigueOf(engine, nearlyRested)).toBe(0);
    expect([35, 36]).toContain(fatigueOf(engine, tired));
    expect(clearedEvents(engine)).toEqual([{ personId: nearlyRested }]);
  });

  it('draws once for each person above 0 and nothing for the person already at 0', async () => {
    const { world } = fatigueWorld();
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });

    const twin = new RngRegistry(world.meta.seed);
    const twinStream = twin.stream(RECOVERY_STREAM);
    intBetween(twinStream, 0, 1);
    intBetween(twinStream, 0, 1);
    expect(engine.exportState().rng.streams[RECOVERY_STREAM]).toEqual(
      twin.toState().streams[RECOVERY_STREAM],
    );
  });

  it('leaves the stream untouched on a day when nobody is tired', async () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .with('one rested person', (context) => {
        context.insert('people', aPerson({ fatigue: 0 }, context.sequence));
      })
      .build();
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(engine.exportState().rng.streams).not.toHaveProperty(RECOVERY_STREAM);
  });

  it('stores a full trace for each changed person that replays to their fatigue, and none for the unchanged one', async () => {
    const { world, people } = fatigueWorld();
    const [rested, nearlyRested, tired] = people;
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });

    expect(storedTrace(engine, rested)).toBeNull();
    for (const personId of [nearlyRested, tired]) {
      const entry = storedTrace(engine, personId);
      if (entry === null || !isFullTrace(entry)) {
        throw new Error(`expected a full trace for ${personId}`);
      }
      expect(entry.ref).toEqual({ kind: 'condition.fatigueRecovery', id: personId });
      expect(entry.date).toBe(world.meta.currentDate);
      expect(entry.value).toBe(fatigueOf(engine, personId));
      expect(replayTrace(entry.trace)).toBe(fatigueOf(engine, personId));
      expect(entry.trace.label).toBe('Fatigue after a day of rest');
      const kinds = entry.trace.children?.flatMap((node) => [
        node.kind,
        ...(node.children ?? []).map((child) => child.kind),
      ]);
      expect(kinds).toEqual([
        'input',
        'subtract',
        'tunable',
        'roll',
        'tunable',
        'subtract',
        'clamp',
      ]);
      expectSerialisable(entry);
    }
  });

  it('gives identical results for the same seed', async () => {
    const first = engineOver(fatigueWorld().world);
    const second = engineOver(fatigueWorld().world);
    await first.advanceDays({ maxDays: 5 });
    await second.advanceDays({ maxDays: 5 });
    expect(second.exportState()).toEqual(first.exportState());
  });

  it('never takes anyone below 0 over many days', async () => {
    const { world, people } = fatigueWorld();
    const engine = engineOver(world);
    const result = await engine.advanceDays({ maxDays: 20 });
    expect(result.failures).toEqual([]);
    for (const personId of people) {
      expect(fatigueOf(engine, personId)).toBe(0);
    }
    // Each person is cleared once: the person who started at 0 never is.
    expect(clearedEvents(engine)).toEqual([{ personId: people[1] }, { personId: people[2] }]);
  });

  it('follows a tunable change from the next day', async () => {
    const { world, people } = fatigueWorld();
    const engine = engineOver(world);
    const changes = [
      engine.command(
        'tunables.setOverride',
        { key: 'condition.fatigueRecoveryPerDay', value: 0 },
        { kind: 'human', playerId: TEST_PLAYER_ID },
      ),
      engine.command(
        'tunables.setOverride',
        { key: 'condition.fatigueRecoveryBonusMax', value: 0 },
        { kind: 'human', playerId: TEST_PLAYER_ID },
      ),
    ];
    for (const change of changes) {
      expect(change.ok).toBe(true);
    }
    await engine.advanceDays({ maxDays: 3 });
    expect(people.map((personId) => fatigueOf(engine, personId))).toEqual([...STARTING_FATIGUE]);
  });
});

describe('condition.fatigue query', () => {
  it('returns null for a person who does not exist', () => {
    const engine = engineOver(fatigueWorld().world);
    const result = engine.query(
      'condition.fatigue',
      { personId: testId('person', 99) },
      OMNISCIENT,
    );
    expect(result).toEqual({ ok: true, data: null });
  });

  it('refuses an ID that is not a person ID', () => {
    const engine = engineOver(fatigueWorld().world);
    const result = engine.queryRaw('condition.fatigue', { personId: 'pro_0000000001' }, OMNISCIENT);
    expect(result.ok).toBe(false);
  });

  it('returns the current fatigue with no trace before any recovery', () => {
    const { world, people } = fatigueWorld();
    const engine = engineOver(world);
    const result = engine.query('condition.fatigue', { personId: people[2] }, OMNISCIENT);
    expect(result).toEqual({
      ok: true,
      data: { personId: people[2], fatigue: 40, traceRef: null },
    });
  });

  it('returns the current fatigue and a trace ref that trace.get resolves', async () => {
    const { world, people } = fatigueWorld();
    const tired = people[2];
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });

    const result = engine.query('condition.fatigue', { personId: tired }, OMNISCIENT);
    if (!result.ok || result.data === null) {
      throw new Error('expected a fatigue view');
    }
    expect(result.data.fatigue).toBe(fatigueOf(engine, tired));
    expect(result.data.traceRef).toEqual({ kind: 'condition.fatigueRecovery', id: tired });
    expect(() => {
      assertSerialisable(result.data, 'condition.fatigue');
    }).not.toThrow();

    if (result.data.traceRef === null) {
      throw new Error('expected a trace ref');
    }
    const resolved = engine.query('trace.get', { ref: result.data.traceRef }, OMNISCIENT);
    if (!resolved.ok) {
      throw new Error(`trace.get failed: ${JSON.stringify(resolved.reasons)}`);
    }
    expect(resolved.data?.value).toBe(result.data.fatigue);
  });

  it('gives a rested person no trace ref', async () => {
    const { world, people } = fatigueWorld();
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(engine.query('condition.fatigue', { personId: people[0] }, OMNISCIENT)).toEqual({
      ok: true,
      data: { personId: people[0], fatigue: 0, traceRef: null },
    });
  });
});

describe('condition.fatigueRecovery failure isolation', () => {
  const failingSystem = defineSystem({
    id: 'conditionFailureTest',
    phases: [
      definePhase({
        id: 'conditionFailureTest.explode',
        group: 'housekeeping',
        order: 20,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const person of ctx.read.tables.people.values()) {
            ctx.tx.update('people', person.id, { fatigue: 99 });
          }
          throw new Error('test phase failure');
        },
      }),
    ],
  });

  it('keeps the fatigue writes from order 10 when a later phase in the same group throws', async () => {
    const { world, people } = fatigueWorld();
    const [rested, nearlyRested, tired] = people;
    const engine = engineOver(world, [...defaultSystems, failingSystem]);

    const result = await engine.advanceDays({ maxDays: 1 });

    expect(result.failures).toEqual([
      expect.objectContaining({ stepId: 'conditionFailureTest.explode' }),
    ]);
    expect(fatigueOf(engine, rested)).toBe(0);
    expect(fatigueOf(engine, nearlyRested)).toBe(0);
    expect([35, 36]).toContain(fatigueOf(engine, tired));
    expect(storedTrace(engine, tired)).not.toBeNull();
    expect(clearedEvents(engine)).toEqual([{ personId: nearlyRested }]);
  });

  it('matches a run without the failing phase', async () => {
    const withFailure = engineOver(fatigueWorld().world, [...defaultSystems, failingSystem]);
    const withoutFailure = engineOver(fatigueWorld().world);
    await withFailure.advanceDays({ maxDays: 1 });
    await withoutFailure.advanceDays({ maxDays: 1 });
    expect(withFailure.exportState().world).toEqual(withoutFailure.exportState().world);
  });
});
