// Injury returns and the slimming of old injury traces. Design: docs/design/health.md#returns
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, diffDays, type GameDate } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { isFullTrace, type TraceRef } from '../../../src/core/trace/store';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import {
  healthSystem,
  injure,
  injuryConditionLossTraceRef,
  injuryTraceRef,
} from '../../../src/systems/health';
import { TEST_START_DATE } from '../../support/builders/build-row';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT = { kind: 'omniscient' } as const;

function engineOver(world: GameWorld, extra: ReturnType<typeof defineSystem>[] = []): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, healthSystem, ...extra],
  });
}

function currentDate(engine: Engine): GameDate {
  return engine.exportState().world.meta.currentDate;
}

function healedEvents(engine: Engine) {
  const events = engine.query(
    'sim.recentEvents',
    { limit: 100, types: ['injury.healed'] },
    OMNISCIENT,
  );
  if (!events.ok) {
    throw new Error(`sim.recentEvents failed: ${JSON.stringify(events.reasons)}`);
  }
  return events.data;
}

function personOf(state: EngineState, personId: PersonId) {
  const person = state.world.tables.people.find((row) => row.id === personId);
  if (person === undefined) {
    throw new Error(`no person ${personId}`);
  }
  return person;
}

/** Two workers: one back in three days, one back in five, both hurt ten days ago. */
function hurtWorld() {
  const since = addDays(TEST_START_DATE, -10);
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) => promotion.withRoster(2))
    .withInjuryCatalog()
    .withInjury(0, { since, expectedReturn: addDays(TEST_START_DATE, 3) })
    .withInjury(1, {
      since,
      expectedReturn: addDays(TEST_START_DATE, 5),
      kindKey: parseContentKey('injury.test-leg'),
      bodyPart: 'legs',
    })
    .build();
  const [early, late] = ids.people;
  const [earlyInjury, lateInjury] = ids.injuries;
  if (
    early === undefined ||
    late === undefined ||
    earlyInjury === undefined ||
    lateInjury === undefined
  ) {
    throw new Error('the hurt world should have two injured workers');
  }
  return { world, early, late, earlyInjury, lateInjury, since };
}

describe('injury returns', () => {
  it('heals on the return date, not the day before, and keeps the row in history', async () => {
    const built = hurtWorld();
    const engine = engineOver(built.world);
    await engine.advanceDays({ maxDays: 3 });
    // Days 0, 1 and 2 have run: the day before the early return.
    expect(currentDate(engine)).toBe(addDays(TEST_START_DATE, 3));
    let state = engine.exportState();
    expect(personOf(state, built.early).injury).not.toBeNull();
    expect(healedEvents(engine)).toEqual([]);

    await engine.advanceDays({ maxDays: 1 });
    state = engine.exportState();
    const returnDay = addDays(TEST_START_DATE, 3);
    expect(personOf(state, built.early).injury).toBeNull();
    expect(personOf(state, built.late).injury).not.toBeNull();
    const row = state.world.tables.injuries.find((entry) => entry.id === built.earlyInjury);
    expect(row?.returnedOn).toBe(returnDay);
    expect(state.world.tables.injuries).toHaveLength(2);
    const events = healedEvents(engine);
    expect(events.map((event) => event.payload)).toEqual([
      {
        personId: built.early,
        injuryId: built.earlyInjury,
        kindKey: 'injury.test-arm',
        daysOut: diffDays(built.since, returnDay),
      },
    ]);
    expect(events[0]?.source).toEqual({ kind: 'phase', id: 'health.recovery' });

    await engine.advanceDays({ maxDays: 2 });
    state = engine.exportState();
    expect(personOf(state, built.late).injury).toBeNull();
    expect(state.world.tables.injuries.every((entry) => entry.returnedOn !== null)).toBe(true);
    expect(healedEvents(engine)).toHaveLength(2);
  });

  it('draws nothing from the recovery stream for a return', async () => {
    const built = hurtWorld();
    const engine = engineOver(built.world);
    const before = engine.exportState().rng;
    await engine.advanceDays({ maxDays: 4 });
    // Nobody is tired, so the only draws a day could take are an injury's, and returns take none.
    expect(engine.exportState().rng).toEqual(before);
  });
});

/** A system that hurts someone every few days with health.injure and checks the world each night. */
function injurerSystem(people: readonly PersonId[], problems: string[]) {
  let day = 0;
  return defineSystem({
    id: 'injurer',
    phases: [
      definePhase({
        id: 'injurer.hurt',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          day += 1;
          if (day % 3 === 0) {
            const personId = people[day % people.length];
            if (personId !== undefined) {
              injure(ctx, personId, { source: 'world' });
            }
          }
        },
      }),
      definePhase({
        id: 'injurer.check',
        group: 'periodic',
        order: 99,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          const report = checkWorld(ctx.read, TABLES, { only: ['invariants'] });
          for (const issue of report.issues) {
            problems.push(`${ctx.date}: ${issue.message}`);
          }
        },
      }),
    ],
  });
}

describe('two years of injuries', () => {
  it('keeps every open row matching its person every day', { timeout: 120_000 }, async () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(8))
      .withInjuryCatalog()
      .build();
    const problems: string[] = [];
    const engine = engineOver(world, [injurerSystem(ids.people, problems)]);
    const result = await engine.advanceDays({ maxDays: 730 });
    expect(result.failures).toEqual([]);
    expect(problems).toEqual([]);
    const state = engine.exportState();
    const { injuries, people } = state.world.tables;
    expect(injuries.length).toBeGreaterThan(50);
    expect(injuries.filter((row) => row.returnedOn !== null).length).toBeGreaterThan(40);
    for (const person of people) {
      const open = injuries.filter((row) => row.personId === person.id && row.returnedOn === null);
      expect(open.length).toBe(person.injury === null ? 0 : 1);
      expect(Object.values(person.condition).every((value) => value >= 0)).toBe(true);
    }
  });
});

describe('health.pruneInjuryDetail', () => {
  function storedKind(engine: Engine, ref: TraceRef): 'full' | 'summary' | 'none' {
    const stored = engine.query('trace.get', { ref }, OMNISCIENT);
    if (!stored.ok || stored.data === null) {
      return 'none';
    }
    return isFullTrace(stored.data) ? 'full' : 'summary';
  }

  it('slims injury traces past the detail window to summaries and keeps the rows', async () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(1))
      .withInjuryCatalog()
      .build();
    const [personId] = ids.people;
    let hurtOn: GameDate | null = null;
    const hurtOnce = defineSystem({
      id: 'hurtOnce',
      phases: [
        definePhase({
          id: 'hurtOnce.run',
          group: 'housekeeping',
          order: 50,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            if (hurtOn === null && personId !== undefined) {
              hurtOn = ctx.date;
              injure(ctx, personId, {
                source: 'world',
                kindKey: parseContentKey('injury.test-arm'),
                severity: 'minor',
              });
            }
          },
        }),
      ],
    });
    const engine = engineOver(world, [hurtOnce]);
    await engine.advanceDays({ maxDays: 1 });
    const [row] = engine.exportState().world.tables.injuries;
    if (row === undefined || hurtOn === null) {
      throw new Error('expected an injury');
    }
    expect(storedKind(engine, injuryTraceRef(row.id))).toBe('full');
    // TEST_START_DATE is a Monday. Four weeks on (the detail window is 28 days), the Monday sweep
    // still keeps it in full.
    await engine.advanceDays({ maxDays: 28 });
    expect(storedKind(engine, injuryTraceRef(row.id))).toBe('full');
    // The next Monday it is past the window.
    await engine.advanceDays({ maxDays: 7 });
    expect(storedKind(engine, injuryTraceRef(row.id))).toBe('summary');
    expect(storedKind(engine, injuryConditionLossTraceRef(row.id))).toBe('summary');
    expect(engine.exportState().world.tables.injuries).toHaveLength(1);
  });
});
