// The health phases, run through the engine. Design: docs/design/health.md
import { describe, expect, it } from 'vitest';
import {
  assertSerialisable,
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
  type SystemBundle,
} from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, addYears } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { intBetween } from '../../../src/core/rng/odds';
import { RngRegistry } from '../../../src/core/rng/registry';
import { replayTrace } from '../../../src/core/trace/replay';
import { isFullTrace, type StoredTraceEntry } from '../../../src/core/trace/store';
import { defaultSystems } from '../../../src/systems';
import { fatigueRecoveryTraceRef, talkedWithoutWrestling } from '../../../src/systems/health';
import { RECOVERY_STREAM } from '../../../src/systems/health/streams';
import type { BodyCondition, Person } from '../../../src/model/entities/person';
import type { GameWorld } from '../../../src/model/tables';
import {
  anAngle,
  aParticipant,
  aPerson,
  flatCondition,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  testId,
  worldBuilder,
  type DeepPartial,
} from '../../support';
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
  const result = engine.query('health.fatigue', { personId }, OMNISCIENT);
  if (!result.ok || result.data === null) {
    throw new Error(`health.fatigue failed for ${personId}: ${JSON.stringify(result)}`);
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
    { limit: 100, types: ['fatigue.cleared'] },
    OMNISCIENT,
  );
  if (!result.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.map((event) => event.payload);
}

describe('health.recovery phase', () => {
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
      expect(entry.ref).toEqual({ kind: 'health.fatigueRecovery', id: personId });
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
        'formula',
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
        { key: 'health.fatigue.recoveryPerDay', value: 0 },
        { kind: 'human', playerId: TEST_PLAYER_ID },
      ),
      engine.command(
        'tunables.setOverride',
        { key: 'health.fatigue.recoveryBonusMax', value: 0 },
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

describe('health.fatigue query', () => {
  it('returns null for a person who does not exist', () => {
    const engine = engineOver(fatigueWorld().world);
    const result = engine.query('health.fatigue', { personId: testId('person', 99) }, OMNISCIENT);
    expect(result).toEqual({ ok: true, data: null });
  });

  it('refuses an ID that is not a person ID', () => {
    const engine = engineOver(fatigueWorld().world);
    const result = engine.queryRaw('health.fatigue', { personId: 'pro_0000000001' }, OMNISCIENT);
    expect(result.ok).toBe(false);
  });

  it('returns the current fatigue with no trace before any recovery', () => {
    const { world, people } = fatigueWorld();
    const engine = engineOver(world);
    const result = engine.query('health.fatigue', { personId: people[2] }, OMNISCIENT);
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

    const result = engine.query('health.fatigue', { personId: tired }, OMNISCIENT);
    if (!result.ok || result.data === null) {
      throw new Error('expected a fatigue view');
    }
    expect(result.data.fatigue).toBe(fatigueOf(engine, tired));
    expect(result.data.traceRef).toEqual({ kind: 'health.fatigueRecovery', id: tired });
    expect(() => {
      assertSerialisable(result.data, 'health.fatigue');
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
    expect(engine.query('health.fatigue', { personId: people[0] }, OMNISCIENT)).toEqual({
      ok: true,
      data: { personId: people[0], fatigue: 0, traceRef: null },
    });
  });
});

describe('health.recovery failure isolation', () => {
  const failingSystem = defineSystem({
    id: 'healthFailureTest',
    phases: [
      definePhase({
        id: 'healthFailureTest.explode',
        group: 'housekeeping',
        order: 30,
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
      expect.objectContaining({ stepId: 'healthFailureTest.explode' }),
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

// ---------------------------------------------------------------------------------------------
// Talking-only show days (owner rule, Sprint 4: promos cost no stamina but cost rest)

describe('health.recovery after a talking-only show day', () => {
  /**
   * Yesterday (the start date, a Monday) promotion A ran a show: person 0 cut a promo, person 1 cut
   * a promo and wrestled person 2. Everyone starts today at fatigue 40.
   */
  function promoWorld() {
    return worldBuilder({ currentDate: addDays(TEST_START_DATE, 1) })
      .withGeography('mini')
      .withCatalogs()
      .withPromotion({}, (promotion) =>
        promotion.withRoster(4, { person: () => ({ fatigue: 40 }) }),
      )
      .withEventInstance({ status: 'completed', date: TEST_START_DATE })
      .withCompletedMatch({ show: 0, sides: [[1], [2]], result: 0 })
      .with('a promo by people 0 and 1', (context) => {
        const [show] = context.ids.eventInstances;
        const [talker, wrestler] = context.ids.people;
        if (show === undefined || talker === undefined || wrestler === undefined) {
          throw new Error('the promo world needs a show and two people');
        }
        const angle = context.insert(
          'segments',
          anAngle({ eventInstanceId: show }, context.sequence),
        );
        for (const personId of [talker, wrestler]) {
          context.insert(
            'participants',
            aParticipant(
              { segmentId: angle.id, personId, role: 'speaker', side: 0 },
              context.sequence,
            ),
          );
        }
      })
      .build();
  }

  it('finds the people who talked and did not wrestle on a show day', () => {
    const { world, ids } = promoWorld();
    expect([...talkedWithoutWrestling(world, TEST_START_DATE)]).toEqual([ids.people[0]]);
    expect(talkedWithoutWrestling(world, addDays(TEST_START_DATE, 1)).size).toBe(0);
  });

  it("halves the next morning's daily recovery for the talker only, and says so", async () => {
    const { world, ids } = promoWorld();
    const engine = engineOver(world);
    const result = await engine.advanceDays({ maxDays: 1 });
    expect(result.failures).toEqual([]);

    const [talker, both, wrestler, rested] = ids.people;
    if (talker === undefined || both === undefined || wrestler === undefined) {
      throw new Error('expected four people');
    }
    expect([37, 38]).toContain(fatigueOf(engine, talker));
    for (const personId of [both, wrestler, rested]) {
      if (personId !== undefined) {
        expect([35, 36]).toContain(fatigueOf(engine, personId));
      }
    }
    const labels = (personId: PersonId): string[] => {
      const entry = storedTrace(engine, personId);
      if (entry === null || !isFullTrace(entry)) {
        throw new Error(`expected a full trace for ${personId}`);
      }
      const found: string[] = [];
      const visit = (node: typeof entry.trace): void => {
        found.push(node.label);
        for (const child of node.children ?? []) {
          visit(child);
        }
      };
      visit(entry.trace);
      return found;
    };
    expect(labels(talker)).toContain('Worked a promo today');
    expect(labels(both)).not.toContain('Worked a promo today');
    expect(labels(wrestler)).not.toContain('Worked a promo today');
  });
});

// ---------------------------------------------------------------------------------------------
// Weekly condition recovery

describe('health.conditionRecovery phase', () => {
  interface Patient {
    readonly age: number;
    readonly condition: Partial<BodyCondition>;
    readonly person?: DeepPartial<Person>;
  }

  /** People employed by promotion A (medical level 1), built with the given ages and condition. */
  function patientWorld(patients: readonly Patient[], medical: 0 | 1 | 2 | 3 = 1) {
    return worldBuilder()
      .withGeography('mini')
      .withPromotion({ policies: { medical } }, (promotion) =>
        promotion.withRoster(patients.length, {
          person: (index) => {
            const patient = patients[index];
            if (patient === undefined) {
              throw new Error(`no patient ${String(index)}`);
            }
            return {
              birthDate: addYears(TEST_START_DATE, -patient.age),
              condition: { ...flatCondition(100), ...patient.condition },
              ...patient.person,
            };
          },
        }),
      )
      .build();
  }

  function conditionOf(engine: Engine, personId: PersonId | undefined): BodyCondition {
    const person = engine.exportState().world.tables.people.find((row) => row.id === personId);
    if (person === undefined) {
      throw new Error(`no person ${String(personId)}`);
    }
    return person.condition;
  }

  it('heals a damaged part by half a point on a Monday, and leaves healthy parts alone', async () => {
    const { world, ids } = patientWorld([{ age: 25, condition: { legs: 80 } }]);
    const engine = engineOver(world);
    const result = await engine.advanceDays({ maxDays: 1 });
    expect(result.failures).toEqual([]);
    expect(conditionOf(engine, ids.people[0])).toEqual({ ...flatCondition(100), legs: 80.5 });
  });

  it('heals on Mondays only', async () => {
    const { world, ids } = patientWorld([{ age: 25, condition: { legs: 80 } }]);
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 7 });
    expect(conditionOf(engine, ids.people[0]).legs).toBe(80.5);
    await engine.advanceDays({ maxDays: 1 });
    expect(conditionOf(engine, ids.people[0]).legs).toBe(81);
  });

  it('does not heal an injured part, but heals the others', async () => {
    const { world, ids } = patientWorld([
      {
        age: 25,
        condition: { legs: 40, arms: 80 },
        person: {
          injury: {
            kindKey: parseContentKey('injury.sprained-ankle'),
            bodyPart: 'legs',
            since: TEST_START_DATE,
            expectedReturn: addDays(TEST_START_DATE, 60),
            canWorkAngles: true,
          },
        },
      },
    ]);
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(conditionOf(engine, ids.people[0])).toMatchObject({ legs: 40, arms: 80.5 });
  });

  it('stops a 55-year-old at their cap of 62.5 and never lowers a part above it', async () => {
    const { world, ids } = patientWorld([
      { age: 55, condition: { legs: 62.2 } },
      { age: 55, condition: { legs: 70 } },
    ]);
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(conditionOf(engine, ids.people[0]).legs).toBe(62.5);
    expect(conditionOf(engine, ids.people[1]).legs).toBe(70);
    await engine.advanceDays({ maxDays: 7 });
    expect(conditionOf(engine, ids.people[0]).legs).toBe(62.5);
    expect(conditionOf(engine, ids.people[1]).legs).toBe(70);
  });

  it('leaves retired people as they are', async () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .with('a retired wrestler', (context) => {
        context.insert(
          'people',
          aPerson({ status: 'retired', condition: { legs: 50 } }, context.sequence),
        );
      })
      .build();
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(conditionOf(engine, ids.people[0]).legs).toBe(50);
  });

  it('draws nothing and stores no traces', async () => {
    const { world } = patientWorld([{ age: 25, condition: { legs: 80 } }]);
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });
    expect(engine.exportState().rng.streams).not.toHaveProperty(RECOVERY_STREAM);
    expect(JSON.stringify(engine.exportState().traces)).not.toContain('Condition after a week');
  });

  it('over 20 weeks heals about half a point a week: faster at medical level 3, slower at 0, and to the cap at 50', async () => {
    const patients: Patient[] = [
      { age: 25, condition: { legs: 80 } },
      { age: 25, condition: { legs: 95 } },
      { age: 50, condition: { legs: 64 } },
      { age: 50, condition: { legs: 90 } },
    ];
    const weeks = 20;
    const after = async (medical: 0 | 1 | 3) => {
      const { world, ids } = patientWorld(patients, medical);
      const engine = engineOver(world);
      const result = await engine.advanceDays({ maxDays: weeks * 7 });
      expect(result.failures).toEqual([]);
      return ids.people.map((personId) => conditionOf(engine, personId).legs);
    };
    const standard = await after(1);
    expect(standard[0]).toBeCloseTo(80 + 0.5 * weeks, 10);
    expect(standard[1]).toBe(100);
    expect(standard[2]).toBe(70);
    expect(standard[3]).toBe(90);
    expect((await after(3))[0]).toBeCloseTo(80 + 0.65 * weeks, 10);
    expect((await after(0))[0]).toBeCloseTo(80 + 0.4 * weeks, 10);
  });
});
