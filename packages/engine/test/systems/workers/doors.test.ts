// The doors, run inside real pipeline steps. Design: docs/design/workers.md#doors
import { describe, expect, it } from 'vitest';
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { AnyDomainEvent } from '../../../src/core/events';
import { InvalidArgumentError } from '../../../src/core/errors';
import type { EmploymentId, PersonId, PromotionId, RegionId } from '../../../src/core/ids';
import type { PhaseContext } from '../../../src/core/pipeline/context';
import { definePhase } from '../../../src/core/pipeline/phase';
import { inputOf, type Traced } from '../../../src/core/trace';
import { isFullTrace, type StoredTrace, type TraceRef } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Employment } from '../../../src/model/entities/employment';
import type { Person } from '../../../src/model/entities/person';
import type { Promotion } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import {
  applyMomentumChange,
  applyMoraleChange,
  applyPopularityChange,
  setAlignment,
  setPush,
  setRole,
  setRoleProblems,
  workersSystem,
  type DoorReason,
} from '../../../src/systems/workers';
import { geographyOf } from '../../../src/systems/world/geography';
import { createPopularityRoller } from '../../../src/systems/world/formulas/popularityRollup';
import { TEST_PLAYER_ID, type DeepPartial } from '../../support/builders/build-row';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT = { kind: 'omniscient' } as const;
const DOOR_EVENT_TYPES = [
  'employment.pushChanged',
  'employment.alignmentChanged',
  'employment.roleChanged',
  'popularity.changed',
  'momentum.changed',
  'morale.changed',
];
const DOOR_PHASE_ID = 'doorTest.run';

/** The mini map's regions, most populous first: 1.8M, 1.2M, 1.1M and 0.9M people. */
const NORTH_1 = testId('region', 1);
const NORTH_2 = testId('region', 2);
const SOUTH_1 = testId('region', 3);
const SOUTH_2 = testId('region', 4);

const REASON: DoorReason = { key: 'test.reason', label: 'Test reason' };

interface DoorWorld {
  world: GameWorld;
  promotionId: PromotionId;
  personId: PersonId;
  employmentId: EmploymentId;
}

interface DoorWorldOptions {
  person?: DeepPartial<Person>;
  employment?: DeepPartial<Employment>;
  promotion?: DeepPartial<Promotion>;
}

/** One promotion based in North 1 with one worker: a midcard face wrestler with 50 charisma. */
function doorWorld(options: DoorWorldOptions = {}): DoorWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion(options.promotion ?? {}, (promotion) =>
      promotion.withRoster(1, {
        person: () => options.person ?? {},
        employment: () => options.employment ?? {},
      }),
    )
    .build();
  const [personId] = ids.people;
  const [employmentId] = ids.employments;
  const promotionId = ids.promotions.A;
  if (personId === undefined || employmentId === undefined || promotionId === undefined) {
    throw new Error('the door world should have one promotion with one worker');
  }
  return { world, promotionId, personId, employmentId };
}

interface DoorRun<T> {
  /** What the body returned, or undefined when the step failed. */
  result: T | undefined;
  /** The message of the step's failure, or null when it committed. */
  failure: string | null;
  /** The door events that were committed, in order. */
  events: AnyDomainEvent[];
  engine: Engine;
  employment: Employment;
  person: Person;
  promotion: Promotion;
  trace: (ref: TraceRef) => StoredTrace | null;
}

/** Runs `body` as a daily phase for one day, so writes, traces and events go through a real step. */
async function runDoors<T>(
  built: DoorWorld,
  body: (ctx: PhaseContext) => T,
  overrides: TunableOverrides = {},
): Promise<DoorRun<T>> {
  let result: T | undefined;
  const doorSystem = defineSystem({
    id: 'doorTest',
    phases: [
      definePhase({
        id: DOOR_PHASE_ID,
        group: 'housekeeping',
        order: 10,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          result = body(ctx);
        },
      }),
    ],
  });
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, workersSystem, doorSystem],
  });
  for (const [key, value] of Object.entries(overrides)) {
    const outcome = engine.commandRaw(
      'tunables.setOverride',
      { key, value },
      { kind: 'human', playerId: TEST_PLAYER_ID },
    );
    if (!outcome.ok) {
      throw new Error(`could not override ${key}: ${JSON.stringify(outcome)}`);
    }
  }
  const advance = await engine.advanceDays({ maxDays: 1 });
  const failed = advance.failures.find((failure) => failure.stepId === DOOR_PHASE_ID);
  if (failed !== undefined) {
    result = undefined;
  }
  const events = engine.query(
    'sim.recentEvents',
    { limit: 100, types: DOOR_EVENT_TYPES },
    OMNISCIENT,
  );
  if (!events.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(events.reasons)}`);
  }
  const { tables } = engine.exportState().world;
  const employment = tables.employments.find((row) => row.id === built.employmentId);
  const person = tables.people.find((row) => row.id === built.personId);
  const promotion = tables.promotions.find((row) => row.id === built.promotionId);
  if (employment === undefined || person === undefined || promotion === undefined) {
    throw new Error('the door world lost a row');
  }
  return {
    result,
    failure: failed === undefined ? null : failed.message,
    events: events.data,
    engine,
    employment,
    person,
    promotion,
    trace: (ref) => {
      const stored = engine.query('trace.get', { ref }, OMNISCIENT);
      if (!stored.ok) {
        throw new Error(`trace.get failed: ${JSON.stringify(stored.reasons)}`);
      }
      if (stored.data !== null && !isFullTrace(stored.data)) {
        throw new Error('expected a full trace');
      }
      return stored.data;
    },
  };
}

function requireTrace<T>(run: DoorRun<T>, ref: TraceRef): StoredTrace {
  const stored = run.trace(ref);
  if (stored === null) {
    throw new Error(`expected a trace at ${ref.kind} ${ref.id}`);
  }
  expect(stored.ref).toEqual(ref);
  expectSerialisable(stored);
  return stored;
}

/** A stored numeric trace as the traced value the replay helper takes. */
function numeric(stored: StoredTrace): Traced<number> {
  if (typeof stored.value !== 'number') {
    throw new Error('expected a numeric trace');
  }
  return { value: stored.value, trace: stored.trace };
}

function payloads(events: readonly AnyDomainEvent[]): unknown[] {
  for (const event of events) {
    expectSerialisable(event.payload);
    expect(event.source).toEqual({ kind: 'phase', id: DOOR_PHASE_ID });
  }
  return events.map((event) => ({ type: event.type, ...event.payload }));
}

function worldFigure(world: GameWorld, regionalPop: Partial<Record<RegionId, number>>): number {
  return createPopularityRoller(geographyOf(world)).rollValues(regionalPop).world;
}

describe('setPush', () => {
  it('writes the push, stores the decision and publishes one event', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setPush(ctx, {
        employmentId: built.employmentId,
        push: 'mainEvent',
        source: 'player',
        reason: REASON,
      }),
    );

    const traceRef = { kind: 'workers.push', id: built.employmentId };
    expect(run.failure).toBeNull();
    expect(run.result).toEqual({ changed: true, before: 'midCard', after: 'mainEvent', traceRef });
    expect(run.employment.push).toBe('mainEvent');
    expect(payloads(run.events)).toEqual([
      {
        type: 'employment.pushChanged',
        employmentId: built.employmentId,
        personId: built.personId,
        promotionId: built.promotionId,
        from: 'midCard',
        to: 'mainEvent',
        source: 'player',
        reasonKey: 'test.reason',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    expect(stored.value).toBe('mainEvent');
    const decision = expectTraceContains(stored, { kind: 'decision', label: 'Push' });
    expect(decision.chosen).toBe('mainEvent');
    expect(decision.reason).toBe('Test reason');
    expect(decision.docRef).toBe('workers.md#doors');
    expect(expectTraceContains(stored, { kind: 'branch', label: 'Was Mid card' }).taken).toBe(true);
  });

  it('does nothing when the push is already that', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setPush(ctx, {
        employmentId: built.employmentId,
        push: 'midCard',
        source: 'ai',
        reason: REASON,
      }),
    );
    expect(run.result).toEqual({
      changed: false,
      before: 'midCard',
      after: 'midCard',
      traceRef: null,
    });
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.push', id: built.employmentId })).toBeNull();
  });
});

describe('setAlignment', () => {
  it('writes the alignment, stores the decision and publishes one event', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setAlignment(ctx, {
        employmentId: built.employmentId,
        alignment: 'heel',
        source: 'ai',
        reason: { key: 'creative.turn', label: 'Turned on their partner' },
      }),
    );

    const traceRef = { kind: 'workers.alignment', id: built.employmentId };
    expect(run.result).toEqual({ changed: true, before: 'face', after: 'heel', traceRef });
    expect(run.employment.alignment).toBe('heel');
    expect(payloads(run.events)).toEqual([
      {
        type: 'employment.alignmentChanged',
        employmentId: built.employmentId,
        personId: built.personId,
        promotionId: built.promotionId,
        from: 'face',
        to: 'heel',
        source: 'ai',
        reasonKey: 'creative.turn',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    const decision = expectTraceContains(stored, { kind: 'decision', label: 'Alignment' });
    expect(decision.chosen).toBe('heel');
    expect(decision.reason).toBe('Turned on their partner');
    expectTraceContains(stored, { kind: 'branch', label: 'Was Face' });
  });

  it('does nothing when the alignment is already that', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setAlignment(ctx, {
        employmentId: built.employmentId,
        alignment: 'face',
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result?.changed).toBe(false);
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.alignment', id: built.employmentId })).toBeNull();
  });
});

describe('setRole', () => {
  it('moves a wrestler to a crew job: adds the person role, ends the push, one event each', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'referee',
        source: 'player',
        reason: { key: 'career.secondCareer', label: 'Retired from the ring' },
      }),
    );

    const traceRef = { kind: 'workers.role', id: built.employmentId };
    expect(run.failure).toBeNull();
    expect(run.result).toEqual({ changed: true, before: 'wrestler', after: 'referee', traceRef });
    expect(run.employment.role).toBe('referee');
    expect(run.employment.push).toBe('none');
    expect(run.person.roles).toEqual(['wrestler', 'referee']);
    const ids = {
      employmentId: built.employmentId,
      personId: built.personId,
      promotionId: built.promotionId,
    };
    expect(payloads(run.events)).toEqual([
      {
        type: 'employment.pushChanged',
        ...ids,
        from: 'midCard',
        to: 'none',
        source: 'player',
        reasonKey: 'role.changed',
      },
      {
        type: 'employment.roleChanged',
        ...ids,
        from: 'wrestler',
        to: 'referee',
        source: 'player',
        reasonKey: 'career.secondCareer',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    const decision = expectTraceContains(stored, { kind: 'decision', label: 'Role' });
    expect(decision.chosen).toBe('referee');
    expect(decision.reason).toBe('Retired from the ring');
    expectTraceContains(stored, { kind: 'branch', label: 'Was Wrestler' });
    expectTraceContains(stored, { kind: 'note', label: 'Gains the referee role' });
    const pushTrace = requireTrace(run, { kind: 'workers.push', id: built.employmentId });
    expect(expectTraceContains(pushTrace, { kind: 'decision' }).reason).toBe(
      'Role changed to referee',
    );
  });

  it('keeps the push of someone moving to a job that is not crew', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'manager',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.employment.role).toBe('manager');
    expect(run.employment.push).toBe('midCard');
    expect(run.person.roles).toEqual(['wrestler', 'manager']);
    expect(run.events.map((event) => event.type)).toEqual(['employment.roleChanged']);
  });

  it('does not add a person role that is already held, or publish a push that is already none', async () => {
    const built = doorWorld({
      person: { roles: ['wrestler', 'announcer'] },
      employment: { push: 'none' },
    });
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'announcer',
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.person.roles).toEqual(['wrestler', 'announcer']);
    expect(run.events.map((event) => event.type)).toEqual(['employment.roleChanged']);
  });

  it('counts an occasional wrestler as a wrestler', async () => {
    const built = doorWorld({
      person: { roles: ['occasionalWrestler', 'manager'] },
      employment: { role: 'manager', push: 'none' },
    });
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'wrestler',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.employment.role).toBe('wrestler');
    expect(run.person.roles).toEqual(['occasionalWrestler', 'manager']);
  });

  it('lets someone who can book become the booker without a new person role', async () => {
    const built = doorWorld({ person: { career: { canBook: true } } });
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'booker',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.employment.role).toBe('booker');
    expect(run.employment.push).toBe('none');
    expect(run.person.roles).toEqual(['wrestler']);
  });

  it('does nothing when the role is already that', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'wrestler',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.result?.changed).toBe(false);
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.role', id: built.employmentId })).toBeNull();
  });

  it('refuses a booker who cannot book, and rolls the step back', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'booker',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.failure).toContain('cannot work as a booker');
    expect(run.employment.role).toBe('wrestler');
    expect(run.events).toEqual([]);
  });

  it('refuses a wrestling role for a non-wrestler', async () => {
    const built = doorWorld({
      person: { roles: ['announcer'], style: 'nonWrestler' },
      employment: { role: 'announcer', push: 'none' },
    });
    const run = await runDoors(built, (ctx) =>
      setRole(ctx, {
        employmentId: built.employmentId,
        role: 'wrestler',
        source: 'player',
        reason: REASON,
      }),
    );
    expect(run.failure).toContain('is not a wrestler');
    expect(run.employment.role).toBe('announcer');
    expect(run.person.roles).toEqual(['announcer']);
  });
});

describe('setRoleProblems', () => {
  it('gives no problems for a change the door accepts', () => {
    const built = doorWorld();
    expect(setRoleProblems(built.world, built.employmentId, 'referee')).toEqual([]);
    expect(setRoleProblems(built.world, built.employmentId, 'wrestler')).toEqual([]);
  });

  it('says why a non-wrestler cannot wrestle', () => {
    const built = doorWorld({
      person: { roles: ['announcer'], style: 'nonWrestler' },
      employment: { role: 'announcer', push: 'none', ringName: 'Test Voice' },
    });
    expect(setRoleProblems(built.world, built.employmentId, 'wrestler')).toEqual([
      {
        code: 'styleForbidsWrestling',
        message: 'Test Voice is not a wrestler and cannot be given a wrestling role',
        field: 'role',
        subject: { kind: 'person', id: built.personId },
      },
    ]);
  });

  it('says why someone cannot book', () => {
    const built = doorWorld({ employment: { ringName: 'Test Worker' } });
    expect(setRoleProblems(built.world, built.employmentId, 'booker')).toEqual([
      {
        code: 'cannotBook',
        message: 'Test Worker cannot work as a booker',
        field: 'role',
        subject: { kind: 'person', id: built.personId },
      },
    ]);
  });

  it('reports an unknown or ended contract instead of throwing', () => {
    const built = doorWorld();
    expect(
      setRoleProblems(built.world, testId('employment', 99), 'referee').map(({ code }) => code),
    ).toEqual(['unknownEmployment']);
    const ended = doorWorld({
      employment: { status: 'released', endedOn: worldBuilder().build().world.meta.currentDate },
    });
    expect(
      setRoleProblems(ended.world, ended.employmentId, 'referee').map(({ code }) => code),
    ).toEqual(['employmentEnded']);
  });
});

describe('applyMoraleChange', () => {
  it('adds the delta, stores a trace that replays and publishes one event', async () => {
    const built = doorWorld({ employment: { morale: 10 } });
    const run = await runDoors(built, (ctx) =>
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta: -25.5,
        source: 'system',
        reason: { key: 'contract.payCut', label: 'Took a pay cut' },
      }),
    );

    const traceRef = { kind: 'workers.morale', id: built.employmentId };
    expect(run.result).toEqual({ changed: true, before: 10, after: -15.5, traceRef });
    expect(run.employment.morale).toBe(-15.5);
    expect(payloads(run.events)).toEqual([
      {
        type: 'morale.changed',
        employmentId: built.employmentId,
        personId: built.personId,
        promotionId: built.promotionId,
        before: 10,
        after: -15.5,
        source: 'system',
        reasonKey: 'contract.payCut',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    expect(stored.value).toBe(-15.5);
    expectTraceReplays(numeric(stored));
    expect(stored.trace.label).toBe('Morale');
    expect(stored.trace.docRef).toBe('workers.md#morale-door');
    expect(expectTraceContains(stored, { kind: 'add', label: 'Took a pay cut' }).operand).toBe(
      -25.5,
    );
  });

  it.each([
    ['the top', 90, 40, 100],
    ['the bottom', -90, -40, -100],
  ])('stops at %s of the scale', async (_end, morale, delta, expected) => {
    const built = doorWorld({ employment: { morale } });
    const run = await runDoors(built, (ctx) =>
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.employment.morale).toBe(expected);
    const stored = requireTrace(run, { kind: 'workers.morale', id: built.employmentId });
    expect(expectTraceContains(stored, { kind: 'clamp' }).applied).toBe(true);
    expectTraceReplays(numeric(stored));
  });

  it.each([
    ['a delta of 0', 20, 0],
    ['a gain at the top', 100, 5],
    ['a loss at the bottom', -100, -5],
  ])('does nothing for %s', async (_name, morale, delta) => {
    const built = doorWorld({ employment: { morale } });
    const run = await runDoors(built, (ctx) =>
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result).toEqual({ changed: false, before: morale, after: morale, traceRef: null });
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.morale', id: built.employmentId })).toBeNull();
  });

  it('applies a big loss as given: the door never softens or sharpens a delta', async () => {
    const built = doorWorld({ employment: { morale: 50 } });
    const run = await runDoors(built, (ctx) =>
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta: inputOf('Loss after the story shield', -1),
        source: 'system',
        reason: { key: 'match.loss', label: 'Lost a match' },
      }),
    );
    expect(run.employment.morale).toBe(49);
    const stored = requireTrace(run, { kind: 'workers.morale', id: built.employmentId });
    expectTraceContains(stored, { kind: 'input', label: 'Loss after the story shield' });
  });
});

describe('applyMomentumChange', () => {
  it('adds the delta to existing momentum', async () => {
    const built = doorWorld({ employment: { momentum: 12 } });
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta: 8,
        source: 'system',
        reason: { key: 'match.win', label: 'Won a match' },
      }),
    );

    const traceRef = { kind: 'workers.momentum', id: built.employmentId };
    expect(run.result).toEqual({ changed: true, before: 12, after: 20, traceRef });
    expect(run.employment.momentum).toBe(20);
    expect(payloads(run.events)).toEqual([
      {
        type: 'momentum.changed',
        employmentId: built.employmentId,
        personId: built.personId,
        promotionId: built.promotionId,
        before: 12,
        after: 20,
        source: 'system',
        reasonKey: 'match.win',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    expectTraceReplays(numeric(stored));
    expect(stored.trace.docRef).toBe('workers.md#momentum-door');
    expect(stored.trace.children?.some((node) => node.kind === 'note')).toBe(false);
  });

  it('starts empty momentum from popularity in the home region of the promotion', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 30, [NORTH_2]: 90 } } });
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta: 5,
        source: 'system',
        reason: REASON,
      }),
    );

    expect(run.result?.before).toBeNull();
    expect(run.employment.momentum).toBe(35);
    expect(payloads(run.events)).toMatchObject([
      { type: 'momentum.changed', before: null, after: 35 },
    ]);
    const stored = requireTrace(run, { kind: 'workers.momentum', id: built.employmentId });
    expectTraceReplays(numeric(stored));
    expectTraceContains(stored, {
      kind: 'note',
      label: 'First appearance: starts from home-region popularity',
    });
    expectTraceContains(stored, { kind: 'input', label: 'Popularity in Test Region North 1' });
    expect(
      expectTraceContains(stored, { kind: 'tunable', label: 'Starting share of home popularity' })
        .key,
    ).toBe('workers.momentum.initialPopFactor');
  });

  it('uses the home region of the employing promotion, not the biggest region', async () => {
    const built = doorWorld({
      promotion: { homeRegionId: SOUTH_2 },
      person: { regionalPop: { [NORTH_1]: 80, [SOUTH_2]: 12 } },
    });
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta: 0,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result?.changed).toBe(true);
    expect(run.employment.momentum).toBe(12);
  });

  it('starts an unknown at 0 and still counts as a change', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta: 0,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result).toMatchObject({ changed: true, before: null, after: 0 });
    expect(run.employment.momentum).toBe(0);
    expect(run.events).toHaveLength(1);
  });

  it('starts everyone at 0 when the starting share is overridden to 0', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 70 } } });
    const run = await runDoors(
      built,
      (ctx) =>
        applyMomentumChange(ctx, {
          employmentId: built.employmentId,
          delta: 3,
          source: 'system',
          reason: REASON,
        }),
      { 'workers.momentum.initialPopFactor': 0 },
    );
    expect(run.employment.momentum).toBe(3);
    const stored = requireTrace(run, { kind: 'workers.momentum', id: built.employmentId });
    expectTraceReplays(numeric(stored));
    const tunable = expectTraceContains(stored, { kind: 'tunable' });
    expect([tunable.value, tunable.overridden]).toEqual([0, true]);
  });

  it.each([
    ['the top', 95, 20, 100],
    ['the bottom', -95, -20, -100],
  ])('stops at %s of the scale', async (_end, momentum, delta, expected) => {
    const built = doorWorld({ employment: { momentum } });
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.employment.momentum).toBe(expected);
    const stored = requireTrace(run, { kind: 'workers.momentum', id: built.employmentId });
    expect(expectTraceContains(stored, { kind: 'clamp' }).applied).toBe(true);
    expectTraceReplays(numeric(stored));
  });

  it('keeps a first appearance within the scale when the starting share is doubled', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 80 } } });
    const run = await runDoors(
      built,
      (ctx) =>
        applyMomentumChange(ctx, {
          employmentId: built.employmentId,
          delta: 0,
          source: 'system',
          reason: REASON,
        }),
      { 'workers.momentum.initialPopFactor': 2 },
    );
    expect(run.employment.momentum).toBe(100);
  });

  it('does nothing when existing momentum would not move', async () => {
    const built = doorWorld({ employment: { momentum: 100 } });
    const run = await runDoors(built, (ctx) =>
      applyMomentumChange(ctx, {
        employmentId: built.employmentId,
        delta: 10,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result).toEqual({ changed: false, before: 100, after: 100, traceRef: null });
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.momentum', id: built.employmentId })).toBeNull();
  });
});

describe('applyPopularityChange', () => {
  it('changes each weighted region of a person, most populous first, with one trace and one event', async () => {
    const before = { [SOUTH_1]: 10, [NORTH_1]: 20 };
    const built = doorWorld({ person: { regionalPop: before } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [SOUTH_1]: 0.5, [NORTH_2]: 0.25, [NORTH_1]: 1 },
        delta: 8,
        source: 'system',
        reason: { key: 'show.appearance', label: 'Appeared on a show' },
      }),
    );

    const after = { [NORTH_1]: 28, [NORTH_2]: 2, [SOUTH_1]: 14 };
    const traceRef = { kind: 'workers.popularity', id: built.personId };
    const worldBefore = worldFigure(built.world, before);
    const worldAfter = worldFigure(built.world, after);
    expect(run.failure).toBeNull();
    expect(run.person.regionalPop).toEqual(after);
    expect(run.result).toEqual({
      changed: true,
      before,
      after,
      traceRef,
      worldBefore,
      worldAfter,
      regionsChanged: [NORTH_1, NORTH_2, SOUTH_1],
      byRegion: {
        [NORTH_1]: { before: 20, after: 28 },
        [NORTH_2]: { before: 0, after: 2 },
        [SOUTH_1]: { before: 10, after: 14 },
      },
    });
    expect(worldAfter).toBeGreaterThan(worldBefore);
    expect(payloads(run.events)).toEqual([
      {
        type: 'popularity.changed',
        subjectKind: 'person',
        subjectId: built.personId,
        worldBefore,
        worldAfter,
        regionsChanged: 3,
        source: 'system',
        reasonKey: 'show.appearance',
      },
    ]);
    const stored = requireTrace(run, traceRef);
    expectTraceReplays(numeric(stored));
    expect(stored.trace.label).toBe('Popularity change: Appeared on a show');
    expect(stored.trace.docRef).toBe('workers.md#popularity-door');
    expect(stored.value).toBe(8 + 2 + 4);
    const lines = (stored.trace.children ?? []).flatMap((node) =>
      node.kind === 'add' ? [node] : [],
    );
    expect(lines.map((node) => [node.label, node.operand])).toEqual([
      ['Test Region North 1', 8],
      ['Test Region North 2', 2],
      ['Test Region South 1', 4],
    ]);
    expectTraceContains(stored, { kind: 'formula', label: 'Popularity in Test Region North 2' });
  });

  it('changes a promotion under its own trace kind, without tapering', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 90 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionWeights: { [NORTH_1]: 1 },
        delta: 6,
        source: 'ai',
        reason: { key: 'show.rating', label: 'Ran a good show' },
      }),
    );
    expect(run.promotion.regionalPop).toEqual({ [NORTH_1]: 96 });
    expect(payloads(run.events)).toMatchObject([
      { type: 'popularity.changed', subjectKind: 'promotion', subjectId: built.promotionId },
    ]);
    const stored = requireTrace(run, { kind: 'promotions.popularity', id: built.promotionId });
    expectTraceReplays(numeric(stored));
    expect(run.trace({ kind: 'workers.popularity', id: built.promotionId })).toBeNull();
  });

  it('tapers a gain above the anchor but not a loss', async () => {
    // Charisma 50 puts the anchor at 50; 70 is half way through the 40-point span.
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 70, [NORTH_2]: 70 } } });
    const gain = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [NORTH_1]: 1 },
        delta: 10,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(gain.person.regionalPop).toEqual({ [NORTH_1]: 75, [NORTH_2]: 70 });
    const stored = requireTrace(gain, { kind: 'workers.popularity', id: built.personId });
    expectTraceReplays(numeric(stored));
    expectTraceContains(stored, { kind: 'formula', label: 'Popularity anchor' });

    const loss = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [NORTH_1]: 1 },
        delta: -10,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(loss.person.regionalPop).toEqual({ [NORTH_1]: 60, [NORTH_2]: 70 });
  });

  it('stops a gain completely with a taper floor of 0, which is then no change at all', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 95 } } });
    const run = await runDoors(
      built,
      (ctx) =>
        applyPopularityChange(ctx, {
          subject: { kind: 'person', id: built.personId },
          regionWeights: { [NORTH_1]: 1 },
          delta: 10,
          source: 'system',
          reason: REASON,
        }),
      { 'workers.popularity.taperFloor': 0 },
    );
    expect(run.result).toMatchObject({ changed: false, traceRef: null, regionsChanged: [] });
    expect(run.person.regionalPop).toEqual({ [NORTH_1]: 95 });
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.popularity', id: built.personId })).toBeNull();
  });

  it.each([
    ['the top', 95, 50, 100],
    ['the bottom', 5, -50, undefined],
  ])('stops at %s of the scale', async (_end, popularity, delta, expected) => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: popularity } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionWeights: { [NORTH_1]: 1 },
        delta,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.failure).toBeNull();
    expect(run.promotion.regionalPop[NORTH_1]).toBe(expected);
    const stored = requireTrace(run, { kind: 'promotions.popularity', id: built.promotionId });
    expectTraceReplays(numeric(stored));
  });

  it('removes a region that reaches 0 instead of storing the 0', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 4, [SOUTH_2]: 30 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [NORTH_1]: 1, [SOUTH_2]: 1 },
        delta: -4,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.failure).toBeNull();
    expect(run.person.regionalPop).toEqual({ [SOUTH_2]: 26 });
    expect(Object.keys(run.person.regionalPop)).toEqual([SOUTH_2]);
    expect(run.result?.regionsChanged).toEqual([NORTH_1, SOUTH_2]);
  });

  it('never stores a region that was unknown and stays at 0', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [NORTH_1]: 1, [NORTH_2]: 0 },
        delta: -3,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result?.changed).toBe(false);
    expect(run.person.regionalPop).toEqual({});
    expect(run.events).toEqual([]);
  });

  it('removes a result below the drop threshold and says so in the trace', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 3, [NORTH_2]: 3 } } });
    const run = await runDoors(
      built,
      (ctx) =>
        applyPopularityChange(ctx, {
          subject: { kind: 'person', id: built.personId },
          regionWeights: { [NORTH_1]: 1, [NORTH_2]: 0.5, [SOUTH_1]: 0.1 },
          delta: -2,
          source: 'system',
          reason: REASON,
        }),
      { 'workers.popularity.dropBelow': 1.5 },
    );
    // North 1 ends at 1 (below 1.5, removed), North 2 at 2 (kept), South 1 was never known.
    expect(run.person.regionalPop).toEqual({ [NORTH_2]: 2 });
    expect(run.result?.regionsChanged).toEqual([NORTH_1, NORTH_2]);
    const stored = requireTrace(run, { kind: 'workers.popularity', id: built.personId });
    expectTraceReplays(numeric(stored));
    expect(stored.value).toBe(-3 - 1);
    expect(
      expectTraceContains(stored, { kind: 'multiply', label: 'Too small to keep' }).reason,
    ).toBe('Below the drop threshold of 1.5, so the region is removed');
  });

  it('keeps a result exactly on the drop threshold', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 3 } } });
    const run = await runDoors(
      built,
      (ctx) =>
        applyPopularityChange(ctx, {
          subject: { kind: 'person', id: built.personId },
          regionWeights: { [NORTH_1]: 1 },
          delta: -1.5,
          source: 'system',
          reason: REASON,
        }),
      { 'workers.popularity.dropBelow': 1.5 },
    );
    expect(run.person.regionalPop).toEqual({ [NORTH_1]: 1.5 });
  });

  it('keeps weights within 0 to 1', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 20, [NORTH_2]: 20 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionWeights: { [NORTH_1]: 4, [NORTH_2]: -1 },
        delta: 10,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.promotion.regionalPop).toEqual({ [NORTH_1]: 30, [NORTH_2]: 20 });
    expect(run.result?.regionsChanged).toEqual([NORTH_1]);
    const stored = requireTrace(run, { kind: 'promotions.popularity', id: built.promotionId });
    expectTraceContains(stored, { kind: 'note', label: /A weight of 4 is outside 0 to 1/ });
    expectTraceContains(stored, { kind: 'note', label: /A weight of -1 is outside 0 to 1/ });
  });

  it("nests the caller's working for the delta once in the trace", async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: built.personId },
        regionWeights: { [NORTH_1]: 1, [NORTH_2]: 1 },
        delta: inputOf('Match rating bonus', 3),
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.person.regionalPop).toEqual({ [NORTH_1]: 3, [NORTH_2]: 3 });
    const stored = requireTrace(run, { kind: 'workers.popularity', id: built.personId });
    expectTraceReplays(numeric(stored));
    const asked = expectTraceContains(stored, { kind: 'input', label: 'Change asked for' });
    expect(asked.children?.map((node) => node.label)).toEqual(['Match rating bonus']);
  });

  it('throws for an unknown region and rolls back everything the step did', async () => {
    const built = doorWorld({ person: { regionalPop: { [NORTH_1]: 20 } } });
    let thrown: unknown;
    const run = await runDoors(built, (ctx) => {
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta: 10,
        source: 'system',
        reason: REASON,
      });
      setPush(ctx, {
        employmentId: built.employmentId,
        push: 'mainEvent',
        source: 'system',
        reason: REASON,
      });
      try {
        applyPopularityChange(ctx, {
          subject: { kind: 'person', id: built.personId },
          regionWeights: { [NORTH_1]: 1, [testId('region', 99)]: 1 },
          delta: 5,
          source: 'system',
          reason: REASON,
        });
      } catch (error) {
        thrown = error;
        throw error;
      }
    });

    expect(thrown).toBeInstanceOf(InvalidArgumentError);
    expect(run.failure).toContain('the ID of a region on the map');
    expect(run.person.regionalPop).toEqual({ [NORTH_1]: 20 });
    expect(run.employment.morale).toBe(0);
    expect(run.employment.push).toBe('midCard');
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'workers.popularity', id: built.personId })).toBeNull();
    expect(run.trace({ kind: 'workers.morale', id: built.employmentId })).toBeNull();
    expect(run.trace({ kind: 'workers.push', id: built.employmentId })).toBeNull();
  });

  it('throws for an unknown person or promotion', async () => {
    const built = doorWorld();
    const person = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'person', id: testId('person', 99) },
        regionWeights: { [NORTH_1]: 1 },
        delta: 5,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(person.failure).toContain('an existing person');
    const promotion = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: testId('promotion', 99) },
        regionWeights: { [NORTH_1]: 1 },
        delta: 5,
        source: 'system',
        reason: REASON,
      }),
    );
    expect(promotion.failure).toContain('an existing promotion');
  });
});

describe('applyPopularityChange with regionDeltas', () => {
  it('moves each region by its own delta, most populous first, with one trace and one event', async () => {
    const before = { [NORTH_1]: 20, [SOUTH_1]: 10 };
    const built = doorWorld({ promotion: { regionalPop: before } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [SOUTH_1]: -2.5, [NORTH_2]: 0.75, [NORTH_1]: 1.234 },
        source: 'system',
        reason: { key: 'show.result', label: 'Test Weekly' },
      }),
    );

    // Each delta lands at weight 1; the stored value is rounded to two decimals.
    const after = { [NORTH_1]: 21.23, [NORTH_2]: 0.75, [SOUTH_1]: 7.5 };
    expect(run.failure).toBeNull();
    expect(run.promotion.regionalPop).toEqual(after);
    expect(run.result).toMatchObject({
      changed: true,
      before,
      after,
      worldBefore: worldFigure(built.world, before),
      worldAfter: worldFigure(built.world, after),
      regionsChanged: [NORTH_1, NORTH_2, SOUTH_1],
      byRegion: {
        [NORTH_1]: { before: 20, after: 21.23 },
        [NORTH_2]: { before: 0, after: 0.75 },
        [SOUTH_1]: { before: 10, after: 7.5 },
      },
    });
    expect(payloads(run.events)).toEqual([
      {
        type: 'popularity.changed',
        subjectKind: 'promotion',
        subjectId: built.promotionId,
        worldBefore: worldFigure(built.world, before),
        worldAfter: worldFigure(built.world, after),
        regionsChanged: 3,
        source: 'system',
        reasonKey: 'show.result',
      },
    ]);
    const stored = requireTrace(run, { kind: 'promotions.popularity', id: built.promotionId });
    expectTraceReplays(numeric(stored));
    expect(stored.trace.label).toBe('Popularity change: Test Weekly');
    const lines = (stored.trace.children ?? []).flatMap((node) =>
      node.kind === 'add' ? [node.label] : [],
    );
    expect(lines).toEqual(['Test Region North 1', 'Test Region North 2', 'Test Region South 1']);
  });

  it('keeps a traced delta inside its own region of the trace', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 20 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [NORTH_1]: inputOf('Beat expectations', 2, undefined, 'points') },
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.promotion.regionalPop).toEqual({ [NORTH_1]: 22 });
    const stored = requireTrace(run, { kind: 'promotions.popularity', id: built.promotionId });
    expectTraceReplays(numeric(stored));
    expectTraceContains(stored, { kind: 'input', label: 'Beat expectations' });
  });

  it('removes a region driven to 0 from the map', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 1.5, [NORTH_2]: 30 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [NORTH_1]: -4, [NORTH_2]: -1 },
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.promotion.regionalPop).toEqual({ [NORTH_2]: 29 });
    expect(Object.keys(run.promotion.regionalPop)).toEqual([NORTH_2]);
    expect(run.result?.byRegion[NORTH_1]).toEqual({ before: 1.5, after: 0 });
  });

  it('throws for an unknown region and rolls back everything the step did', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 20 } } });
    const run = await runDoors(built, (ctx) => {
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [NORTH_1]: 2 },
        source: 'system',
        reason: REASON,
      });
      return applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [NORTH_1]: 1, [testId('region', 99)]: 1 },
        source: 'system',
        reason: REASON,
      });
    });
    expect(run.failure).toContain('the ID of a region on the map');
    expect(run.promotion.regionalPop).toEqual({ [NORTH_1]: 20 });
    expect(run.events).toEqual([]);
    expect(run.trace({ kind: 'promotions.popularity', id: built.promotionId })).toBeNull();
  });

  it('refuses regionDeltas together with regionWeights or delta', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 20 } } });
    const mixed = {
      subject: { kind: 'promotion', id: built.promotionId } as const,
      regionDeltas: { [NORTH_1]: 1 },
      regionWeights: { [NORTH_1]: 1 },
      delta: 1,
      source: 'system' as const,
      reason: REASON,
    };
    let thrown: unknown;
    const run = await runDoors(built, (ctx) => {
      try {
        // @ts-expect-error: the types refuse the mix; this checks the guard a plain JS caller hits.
        return applyPopularityChange(ctx, mixed);
      } catch (error) {
        thrown = error;
        throw error;
      }
    });
    expect(thrown).toBeInstanceOf(InvalidArgumentError);
    expect(run.failure).toContain('either regionDeltas, or regionWeights with delta, never both');
    expect(run.promotion.regionalPop).toEqual({ [NORTH_1]: 20 });
  });

  it('changes nothing, records nothing and publishes nothing for deltas of 0', async () => {
    const built = doorWorld({ promotion: { regionalPop: { [NORTH_1]: 20 } } });
    const run = await runDoors(built, (ctx) =>
      applyPopularityChange(ctx, {
        subject: { kind: 'promotion', id: built.promotionId },
        regionDeltas: { [NORTH_1]: 0, [NORTH_2]: 0 },
        source: 'system',
        reason: REASON,
      }),
    );
    expect(run.result).toMatchObject({
      changed: false,
      traceRef: null,
      regionsChanged: [],
      byRegion: { [NORTH_1]: { before: 20, after: 20 }, [NORTH_2]: { before: 0, after: 0 } },
    });
    expect(run.events).toEqual([]);
  });
});

describe('every employment door', () => {
  const doors = [
    [
      'setPush',
      (ctx: PhaseContext, employmentId: EmploymentId) =>
        setPush(ctx, { employmentId, push: 'mainEvent', source: 'system', reason: REASON }),
    ],
    [
      'setAlignment',
      (ctx: PhaseContext, employmentId: EmploymentId) =>
        setAlignment(ctx, { employmentId, alignment: 'heel', source: 'system', reason: REASON }),
    ],
    [
      'setRole',
      (ctx: PhaseContext, employmentId: EmploymentId) =>
        setRole(ctx, { employmentId, role: 'referee', source: 'system', reason: REASON }),
    ],
    [
      'applyMomentumChange',
      (ctx: PhaseContext, employmentId: EmploymentId) =>
        applyMomentumChange(ctx, { employmentId, delta: 5, source: 'system', reason: REASON }),
    ],
    [
      'applyMoraleChange',
      (ctx: PhaseContext, employmentId: EmploymentId) =>
        applyMoraleChange(ctx, { employmentId, delta: 5, source: 'system', reason: REASON }),
    ],
  ] as const;

  it.each(doors)('%s throws for an unknown employment', async (_name, door) => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) => door(ctx, testId('employment', 99)));
    expect(run.failure).toContain('an existing employment');
    expect(run.events).toEqual([]);
  });

  it.each(doors)('%s throws for an ended employment and writes nothing', async (_name, door) => {
    const probe = doorWorld();
    const built = doorWorld({
      employment: { status: 'released', endedOn: probe.world.meta.currentDate },
    });
    const run = await runDoors(built, (ctx) => door(ctx, built.employmentId));
    expect(run.failure).toContain('an employment that has not ended (it is released)');
    expect(run.employment).toEqual(built.world.tables.employments.require(built.employmentId));
    expect(run.events).toEqual([]);
  });

  it.each(doors)('%s works on a signed contract that has not started', async (_name, door) => {
    const built = doorWorld({ employment: { status: 'signed' } });
    const run = await runDoors(built, (ctx) => door(ctx, built.employmentId));
    expect(run.failure).toBeNull();
    expect(run.events.length).toBeGreaterThan(0);
  });

  it('refuses an empty reason', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) =>
      applyMoraleChange(ctx, {
        employmentId: built.employmentId,
        delta: 5,
        source: 'system',
        reason: { key: '', label: 'Something' },
      }),
    );
    expect(run.failure).toContain('reason.key');
  });
});

describe('two changes on one day', () => {
  it('keeps the later trace and both events', async () => {
    const built = doorWorld();
    const run = await runDoors(built, (ctx) => {
      for (const delta of [5, 7]) {
        applyMoraleChange(ctx, {
          employmentId: built.employmentId,
          delta,
          source: 'system',
          reason: REASON,
        });
      }
    });
    expect(run.employment.morale).toBe(12);
    expect(payloads(run.events)).toMatchObject([
      { before: 0, after: 5 },
      { before: 5, after: 12 },
    ]);
    const stored = requireTrace(run, { kind: 'workers.morale', id: built.employmentId });
    expect(stored.value).toBe(12);
  });
});
