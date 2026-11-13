// health.injure: the one way anyone gets hurt. Design: docs/design/health.md#injuries
import { describe, expect, it } from 'vitest';
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { parseContentKey } from '../../../src/core/content-key';
import { diffDays } from '../../../src/core/date';
import type { AnyDomainEvent } from '../../../src/core/events';
import type { PersonId, SegmentId } from '../../../src/core/ids';
import type { PhaseContext } from '../../../src/core/pipeline/context';
import { definePhase } from '../../../src/core/pipeline/phase';
import { constantOf, findTraceNodes, type Traced } from '../../../src/core/trace';
import { isFullTrace, type StoredTrace, type TraceRef } from '../../../src/core/trace/store';
import type { EngineState } from '../../../src/core/api';
import type { GameWorld } from '../../../src/model/tables';
import {
  healthInjuryHandler,
  injure,
  INJURIES_STREAM,
  injuryConditionLossTraceRef,
  injuryRecordChanceTraceRef,
  injuryTraceRef,
  NEITHER_TRAIT_BRANCH,
  SEVERITY_SET_BY_MATCH,
  type InjureOptions,
  type InjureResult,
} from '../../../src/systems/health';
import { aPerson } from '../../support/builders/people';
import { testId } from '../../support/ids';
import { TEST_INJURY_CATALOG } from '../../support/injuries';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT = { kind: 'omniscient' } as const;
const TEST_PHASE_ID = 'injureTest.run';
const ARM = parseContentKey('injury.test-arm');
const EVENT_TYPES = ['injury.sustained', 'injury.healed', 'morale.changed'];

interface InjureWorld {
  world: GameWorld;
  /** Two contracted workers of a promotion with medical care level 1, then a free agent. */
  people: readonly PersonId[];
  retired: PersonId;
  deceased: PersonId;
  segmentId: SegmentId;
}

function injureWorld(options: { catalog?: boolean } = {}): InjureWorld {
  let builder = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Apex Wrestling' }, (promotion) => promotion.withRoster(2))
    .with('a free agent, a retired and a deceased person', (context) => {
      context.insert('people', aPerson({}, context.sequence));
      context.insert('people', aPerson({ status: 'retired' }, context.sequence));
      context.insert('people', aPerson({ status: 'deceased' }, context.sequence));
    })
    .withEventInstance()
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 });
  if (options.catalog !== false) {
    builder = builder.withInjuryCatalog();
  }
  const { world, ids } = builder.build();
  const [first, second, freeAgent, retired, deceased] = ids.people;
  const [segmentId] = ids.segments;
  if (
    first === undefined ||
    second === undefined ||
    freeAgent === undefined ||
    retired === undefined ||
    deceased === undefined ||
    segmentId === undefined
  ) {
    throw new Error('the injure world is missing people or its match');
  }
  return { world, people: [first, second, freeAgent], retired, deceased, segmentId };
}

interface InjureRun<T> {
  result: T | undefined;
  failure: string | null;
  events: AnyDomainEvent[];
  logs: string[];
  before: EngineState;
  after: EngineState;
  engine: Engine;
}

/** Runs `body` as a daily phase for one day, so writes, traces and events go through a real step. */
async function runInjure<T>(
  built: InjureWorld,
  body: (ctx: PhaseContext) => T,
): Promise<InjureRun<T>> {
  let result: T | undefined;
  const logs: string[] = [];
  const testSystem = defineSystem({
    id: 'injureTest',
    phases: [
      definePhase({
        id: TEST_PHASE_ID,
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          const log = ctx.log;
          result = body({
            ...ctx,
            log: (message) => {
              logs.push(message);
              log(message);
            },
          });
        },
      }),
    ],
  });
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, testSystem],
  });
  const before = engine.exportState();
  const advance = await engine.advanceDays({ maxDays: 1 });
  const failed = advance.failures.find((failure) => failure.stepId === TEST_PHASE_ID);
  const events = engine.query('sim.recentEvents', { limit: 100, types: EVENT_TYPES }, OMNISCIENT);
  if (!events.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(events.reasons)}`);
  }
  return {
    result: failed === undefined ? result : undefined,
    failure: failed === undefined ? null : failed.message,
    events: events.data,
    logs,
    before,
    after: engine.exportState(),
    engine,
  };
}

function fullTrace(engine: Engine, ref: TraceRef): StoredTrace {
  const stored = engine.query('trace.get', { ref }, OMNISCIENT);
  if (!stored.ok || stored.data === null || !isFullTrace(stored.data)) {
    throw new Error(`expected a full trace at ${ref.kind} ${ref.id}`);
  }
  expectSerialisable(stored.data);
  return stored.data;
}

function numeric(stored: StoredTrace): Traced<number> {
  if (typeof stored.value !== 'number') {
    throw new Error('expected a numeric trace');
  }
  return { value: stored.value, trace: stored.trace };
}

function okId(result: InjureResult | undefined) {
  if (result === undefined || !result.ok) {
    throw new Error(`expected an injury, got ${JSON.stringify(result)}`);
  }
  return result.injuryId;
}

const ARM_OPTIONS: InjureOptions = { kindKey: ARM, source: 'world', severity: 'moderate' };

describe('injure', () => {
  it('writes the row, the pointer and the condition loss, and stores the traces under the injury id', async () => {
    const built = injureWorld();
    const [personId] = built.people;
    const run = await runInjure(built, (ctx) => injure(ctx, personId!, ARM_OPTIONS));
    const injuryId = okId(run.result);
    const { tables } = run.after.world;
    const row = tables.injuries.find((entry) => entry.id === injuryId);
    const person = tables.people.find((entry) => entry.id === personId);
    const personBefore = run.before.world.tables.people.find((entry) => entry.id === personId);
    if (row === undefined || person === undefined || personBefore === undefined) {
      throw new Error('expected the row and the person');
    }
    expect(injuryId).toMatch(/^inj_/);
    expect(row).toMatchObject({
      personId,
      kindKey: ARM,
      bodyPart: 'arms',
      severity: 'moderate',
      since: run.before.world.meta.currentDate,
      returnedOn: null,
      source: 'world',
      segmentId: null,
      noticedOn: row.since,
    });
    const days = numeric(fullTrace(run.engine, injuryTraceRef(injuryId)));
    expectTraceReplays(days);
    expect(diffDays(row.since, row.expectedReturn)).toBe(days.value);
    // A 10-20 day kind, moderate (×1), no trait, medical care level 1 (×1).
    expect(days.value).toBeGreaterThanOrEqual(10);
    expect(days.value).toBeLessThanOrEqual(20);
    expect(person.injury).toEqual({
      kindKey: ARM,
      bodyPart: 'arms',
      since: row.since,
      expectedReturn: row.expectedReturn,
      canWorkAngles: row.canWorkAngles,
    });
    const loss = numeric(fullTrace(run.engine, injuryConditionLossTraceRef(injuryId)));
    expectTraceReplays(loss);
    expect(loss.value).toBeCloseTo(days.value / 7, 10);
    expect(row.conditionLoss).toBe(loss.value);
    expect(person.condition.arms).toBeCloseTo(personBefore.condition.arms - loss.value, 10);
    expect(person.condition.legs).toBe(personBefore.condition.legs);
    // No chance was given, so none is stored.
    const chance = run.engine.query(
      'trace.get',
      { ref: injuryRecordChanceTraceRef(injuryId) },
      OMNISCIENT,
    );
    expect(chance.ok && chance.data).toBeNull();
  });

  it('explains the days out: catalog range, severity, traits, medical care and the angles roll', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) => injure(ctx, built.people[0]!, ARM_OPTIONS));
    const trace = fullTrace(run.engine, injuryTraceRef(okId(run.result))).trace;
    const labels = findTraceNodes(trace, 'roll').map((node) => node.label);
    expect(labels).toEqual(['Test arm injury: 10–20 days', 'Can they work angles?']);
    expect(
      findTraceNodes(trace, 'roll').every((node) => node.roll.stream === INJURIES_STREAM),
    ).toBe(true);
    const branches = findTraceNodes(trace, 'branch').map((node) => node.label);
    expect(branches).toContain(SEVERITY_SET_BY_MATCH);
    expect(branches).toContain(NEITHER_TRAIT_BRANCH);
    expect(findTraceNodes(trace, 'multiply').map((node) => node.label)).toContain(
      'Medical care: Apex Wrestling (level 1)',
    );
    const notes = findTraceNodes(trace, 'note').map((node) => node.label);
    expect(
      notes.some((note) => note === 'Can still work angles while out') ||
        notes.some((note) => note === 'Cannot work angles while out'),
    ).toBe(true);
  });

  it('rolls the kind and severity when the caller names neither', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) => injure(ctx, built.people[2]!, { source: 'world' }));
    const injuryId = okId(run.result);
    const row = run.after.world.tables.injuries.find((entry) => entry.id === injuryId);
    expect(TEST_INJURY_CATALOG.map((kind) => kind.key)).toContain(row?.kindKey);
    const trace = fullTrace(run.engine, injuryTraceRef(injuryId)).trace;
    expect(findTraceNodes(trace, 'roll').map((node) => node.label)).toContain('Severity roll');
    // A free agent gets the free-agent level, with no promotion named.
    expect(findTraceNodes(trace, 'multiply').map((node) => node.label)).toContain(
      'No employer: standard care',
    );
  });

  it('keeps to the body part hint when the catalog has a kind there', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) =>
      injure(ctx, built.people[0]!, { source: 'world', bodyPart: 'legs' }),
    );
    const row = run.after.world.tables.injuries.find((entry) => entry.id === okId(run.result));
    expect(row?.kindKey).toBe('injury.test-leg');
    const neck = await runInjure(injureWorld(), (ctx) =>
      injure(ctx, built.people[0]!, { source: 'world', bodyPart: 'neck' }),
    );
    okId(neck.result);
  });

  it('publishes injury.sustained, and nothing about morale', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) =>
      injure(ctx, built.people[0]!, {
        kindKey: ARM,
        source: 'segment',
        segmentId: built.segmentId,
        severity: 'severe',
      }),
    );
    const injuryId = okId(run.result);
    const row = run.after.world.tables.injuries.find((entry) => entry.id === injuryId);
    expect(run.events.map((event) => event.type)).toEqual(['injury.sustained']);
    const [event] = run.events;
    expect(event?.payload).toEqual({
      personId: built.people[0],
      injuryId,
      kindKey: ARM,
      bodyPart: 'arms',
      severity: 'severe',
      expectedReturn: row?.expectedReturn,
      source: 'segment',
      segmentId: built.segmentId,
    });
    expect(event?.source).toEqual({ kind: 'phase', id: TEST_PHASE_ID });
    expectSerialisable(event?.payload);
    expect(run.after.world.tables.employments).toEqual(run.before.world.tables.employments);
  });

  it('stores the chance that led to the injury under the injury id', async () => {
    const built = injureWorld();
    const chance = constantOf('Injury chance', 0.04, 'Test chance');
    const run = await runInjure(built, (ctx) =>
      injure(ctx, built.people[0]!, { ...ARM_OPTIONS, chanceTrace: chance }),
    );
    const stored = fullTrace(run.engine, injuryRecordChanceTraceRef(okId(run.result)));
    expect(stored.value).toBe(0.04);
  });

  it('refuses a second injury, the retired, the dead, the missing, an unknown kind and a world with no catalog, changing nothing', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) => {
      const first = injure(ctx, built.people[0]!, ARM_OPTIONS);
      const afterFirst = JSON.stringify(ctx.read.tables.people.get(built.people[0]!));
      const refusals = [
        injure(ctx, built.people[0]!, ARM_OPTIONS),
        injure(ctx, built.people[0]!, { source: 'world' }),
        injure(ctx, built.retired, ARM_OPTIONS),
        injure(ctx, built.deceased, ARM_OPTIONS),
        injure(ctx, testId('person', 99), ARM_OPTIONS),
        injure(ctx, built.people[1]!, {
          kindKey: parseContentKey('injury.made-up'),
          source: 'world',
        }),
      ];
      const unchanged = JSON.stringify(ctx.read.tables.people.get(built.people[0]!)) === afterFirst;
      return { first, refusals, unchanged };
    });
    expect(run.result?.first.ok).toBe(true);
    expect(run.result?.refusals).toEqual([
      { ok: false, reason: 'alreadyInjured' },
      { ok: false, reason: 'alreadyInjured' },
      { ok: false, reason: 'notInjurable' },
      { ok: false, reason: 'notInjurable' },
      { ok: false, reason: 'notInjurable' },
      { ok: false, reason: 'unknownKind' },
    ]);
    expect(run.result?.unchanged).toBe(true);
    expect(run.after.world.tables.injuries).toHaveLength(1);
    expect(run.events.filter((event) => event.type === 'injury.sustained')).toHaveLength(1);

    const empty = injureWorld({ catalog: false });
    const noCatalog = await runInjure(empty, (ctx) =>
      injure(ctx, empty.people[0]!, { source: 'world' }),
    );
    expect(noCatalog.result).toEqual({ ok: false, reason: 'noCatalog' });
    expect(noCatalog.logs).toEqual([
      'health.injure: this world has no injury catalog, so nobody was hurt',
    ]);
    expect(noCatalog.after.world.tables).toEqual(noCatalog.before.world.tables);
    expect(noCatalog.after.rng).toEqual(noCatalog.before.rng);
    expect(noCatalog.events).toEqual([]);
  });

  it('draws nothing when it refuses', async () => {
    const built = injureWorld();
    const run = await runInjure(built, (ctx) => injure(ctx, built.retired, ARM_OPTIONS));
    expect(run.result).toEqual({ ok: false, reason: 'notInjurable' });
    expect(run.after.rng).toEqual(run.before.rng);
    expect(run.after.world.tables).toEqual(run.before.world.tables);
  });

  it('wants a segment exactly for a segment injury', async () => {
    const built = injureWorld();
    const missing = await runInjure(built, (ctx) =>
      injure(ctx, built.people[0]!, { kindKey: ARM, source: 'segment' }),
    );
    expect(missing.failure).toMatch(/segmentId/);
    expect(missing.after.world.tables.injuries).toEqual([]);
    const extra = await runInjure(built, (ctx) =>
      injure(ctx, built.people[0]!, { ...ARM_OPTIONS, segmentId: built.segmentId }),
    );
    expect(extra.failure).toMatch(/segmentId/);
  });

  it('is MTCH4’s injury handler: a segment injury from the hint, with the chance kept', async () => {
    const built = injureWorld();
    const chance = constantOf('Injury chance', 0.1, 'Test chance');
    const run = await runInjure(built, (ctx) => {
      const request = {
        personId: built.people[0]!,
        segmentId: built.segmentId,
        eventInstanceId: ctx.read.tables.segments.require(built.segmentId).eventInstanceId,
        date: ctx.date,
        bodyPartHint: 'head' as const,
        chanceTrace: chance,
      };
      return [healthInjuryHandler.apply(ctx, request), healthInjuryHandler.apply(ctx, request)];
    });
    const [hurt, again] = run.result ?? [];
    const [row] = run.after.world.tables.injuries;
    expect(hurt?.injuryTraceRef).toEqual(injuryTraceRef(row!.id));
    expect(again?.injuryTraceRef).toBeNull();
    expect(row).toMatchObject({
      kindKey: 'injury.test-head',
      source: 'segment',
      segmentId: built.segmentId,
    });
    expect(fullTrace(run.engine, injuryRecordChanceTraceRef(row!.id)).value).toBe(0.1);
  });
});
