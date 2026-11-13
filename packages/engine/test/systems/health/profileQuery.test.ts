// `health.profile`, the worker profile's Health tab. Design: docs/design/health.md#the-health-profile
import { describe, expect, it } from 'vitest';
import {
  assertSerialisable,
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { controllerViewer, OMNISCIENT_VIEWER, type Viewer } from '../../../src/core/api/controller';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays, addYears, diffDays } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { startCalc } from '../../../src/core/trace/calc';
import { replayTrace } from '../../../src/core/trace/replay';
import { BODY_PARTS } from '../../../src/model/entities/person';
import type { GameWorld } from '../../../src/model/tables';
import {
  fatigueBandOf,
  HEALTH_PROFILE_HISTORY_LIMIT,
  healthSystem,
  INJURED_PART_BRANCH,
  injure,
  type HealthProfile,
} from '../../../src/systems/health';
import {
  flatCondition,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  testId,
  worldBuilder,
  type WorldBuilder,
} from '../../support';

const OWNER = controllerViewer({ kind: 'human', playerId: TEST_PLAYER_ID });
/** Another human seat, running the rival promotion. */
const RIVAL_PLAYER = 'player-2';
const RIVAL = controllerViewer({ kind: 'human', playerId: RIVAL_PLAYER });
const ARM = parseContentKey('injury.test-arm');

interface ProfileWorld {
  world: GameWorld;
  /** The player's workers. */
  mine: readonly [PersonId, PersonId];
  /** The rival promotion's worker. */
  theirs: PersonId;
}

/**
 * The player's promotion (two workers, 40 fatigue, condition 60, 45 years old) and a rival run by
 * a second human, each with one worker. `extra` adds rows before the build.
 */
function profileWorld(
  extra: (builder: WorldBuilder) => WorldBuilder = (builder) => builder,
): ProfileWorld {
  const builder = worldBuilder()
    .withGeography('mini')
    .withInjuryCatalog()
    .withPromotion(
      { name: 'My Wrestling', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) =>
        promotion.withRoster(2, {
          person: () => ({
            fatigue: 40,
            condition: flatCondition(60),
            birthDate: addYears(TEST_START_DATE, -45),
          }),
        }),
    )
    .withPromotion(
      { name: 'Rival Wrestling', controller: { kind: 'human', playerId: RIVAL_PLAYER } },
      (promotion) => promotion.withRoster(1),
    );
  const { world, ids } = extra(builder).build();
  const [first, second, theirs] = ids.people;
  if (first === undefined || second === undefined || theirs === undefined) {
    throw new Error('the profile world should have three workers');
  }
  return { world, mine: [first, second], theirs };
}

function engineOver(world: GameWorld): Engine {
  return createEngine({ state: initialEngineState(world), systems: [simSystem, healthSystem] });
}

function profileOf(
  engine: Engine,
  personId: PersonId,
  viewer: Viewer = OMNISCIENT_VIEWER,
): HealthProfile {
  const result = engine.query('health.profile', { personId }, viewer);
  if (!result.ok || result.data === null) {
    throw new Error(`health.profile failed for ${personId}: ${JSON.stringify(result)}`);
  }
  return result.data;
}

describe('health.profile for someone healthy', () => {
  it('returns fatigue with its band, six parts with the age cap and next week, and the care', () => {
    const { world, mine } = profileWorld();
    const engine = engineOver(world);
    const profile = profileOf(engine, mine[0]);

    expect(profile.personId).toBe(mine[0]);
    expect(profile.fatigue).toEqual({ value: 40, band: 'tired', traceRef: null });
    expect(profile.condition.map((part) => part.part)).toEqual([...BODY_PARTS]);
    for (const part of profile.condition) {
      expect(part.value).toBe(60);
      expect(part.injured).toBe(false);
      // A 45-year-old's cap is below 100 by default, and both numbers replay from their traces.
      expect(part.cap.value).toBeLessThan(100);
      expect(replayTrace(part.cap.trace)).toBe(part.cap.value);
      expect(part.nextCheck.value).toBeGreaterThan(60);
      expect(part.nextCheck.value).toBeLessThanOrEqual(part.cap.value);
      expect(replayTrace(part.nextCheck.trace)).toBe(part.nextCheck.value);
    }
    const promotion = [...engine.exportState().world.tables.promotions].find(
      (row) => row.name === 'My Wrestling',
    );
    expect(profile.medical).toEqual({
      level: promotion?.policies.medical,
      promotionId: promotion?.id,
      promotionName: 'My Wrestling',
    });
    expect(profile.current).toBeNull();
    expect(profile.history).toEqual([]);
    expect(() => {
      assertSerialisable(profile, 'health.profile');
    }).not.toThrow();
  });

  it('gives the same answer to the owner, a rival and the omniscient viewer', () => {
    const { world, mine } = profileWorld();
    const engine = engineOver(world);
    const omniscient = profileOf(engine, mine[0]);
    expect(profileOf(engine, mine[0], OWNER)).toEqual(omniscient);
    expect(profileOf(engine, mine[0], RIVAL)).toEqual(omniscient);
  });

  it('links fatigue to the recovery trace once one is stored, and trace.get resolves it', async () => {
    const { world, mine } = profileWorld();
    const engine = engineOver(world);
    await engine.advanceDays({ maxDays: 1 });

    const { fatigue } = profileOf(engine, mine[0]);
    expect(fatigue.traceRef).toEqual({ kind: 'health.fatigueRecovery', id: mine[0] });
    expect(fatigue.value).toBeLessThan(40);
    if (fatigue.traceRef === null) {
      throw new Error('expected a trace ref');
    }
    const resolved = engine.query('trace.get', { ref: fatigue.traceRef }, OMNISCIENT_VIEWER);
    expect(resolved.ok && resolved.data?.value).toBe(fatigue.value);
  });

  it('returns null for a person who does not exist, and refuses an id that is not a person', () => {
    const engine = engineOver(profileWorld().world);
    expect(
      engine.query('health.profile', { personId: testId('person', 99) }, OMNISCIENT_VIEWER),
    ).toEqual({ ok: true, data: null });
    expect(
      engine.queryRaw('health.profile', { personId: 'pro_0000000001' }, OMNISCIENT_VIEWER).ok,
    ).toBe(false);
  });
});

describe('fatigue bands', () => {
  it('splits 0–100 into four quarters, a value between bands going up', () => {
    expect([0, 24, 24.5, 25, 49, 50, 74, 75, 100].map(fatigueBandOf)).toEqual([
      'fresh',
      'fresh',
      'tired',
      'tired',
      'tired',
      'weary',
      'weary',
      'spent',
      'spent',
    ]);
  });
});

describe('health.profile with a current injury', () => {
  /** The real health system plus a phase that hurts the person on day one, with a chance trace. */
  function engineHurting(world: GameWorld, personId: PersonId): Engine {
    let done = false;
    const hurt = defineSystem({
      id: 'hurtOnDayOne',
      phases: [
        definePhase({
          id: 'hurtOnDayOne.run',
          group: 'housekeeping',
          order: 50,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            if (done) {
              return;
            }
            done = true;
            const chanceTrace = startCalc('Injury chance', 0.02, { unit: 'probability' }).done();
            const outcome = injure(ctx, personId, {
              source: 'world',
              kindKey: ARM,
              severity: 'moderate',
              chanceTrace,
            });
            expect(outcome.ok).toBe(true);
          },
        }),
      ],
    });
    const health = {
      ...healthSystem,
      phases: healthSystem.phases.filter((phase) => phase.id !== 'health.offscreenInjuries'),
    };
    return createEngine({ state: initialEngineState(world), systems: [simSystem, health, hurt] });
  }

  it('shows the injury with its traces, the days left and the injured part', async () => {
    const { world, mine } = profileWorld();
    const engine = engineHurting(world, mine[0]);
    const advanced = await engine.advanceDays({ maxDays: 2 });
    expect(advanced.failures).toEqual([]);

    const profile = profileOf(engine, mine[0], OWNER);
    const current = profile.current;
    if (current === null) {
      throw new Error('expected a current injury');
    }
    const today = engine.exportState().world.meta.currentDate;
    expect(current).toMatchObject({
      kindKey: ARM,
      label: 'Test arm injury',
      bodyPart: 'arms',
      severity: 'moderate',
      returnedOn: null,
      source: 'world',
      segmentId: null,
      daysOut: diffDays(current.since, current.expectedReturn),
      daysRemaining: diffDays(today, current.expectedReturn),
      durationTraceRef: { kind: 'health.injury', id: current.injuryId },
      conditionLossTraceRef: { kind: 'health.injuryConditionLoss', id: current.injuryId },
      chanceTraceRef: { kind: 'health.injuryChance', id: current.injuryId },
      // The stop on own injuries is off by default, so the injury was noticed on the day.
      pendingNotice: false,
    });
    for (const ref of [current.durationTraceRef, current.conditionLossTraceRef]) {
      if (ref === null) {
        throw new Error('expected a stored trace');
      }
      const resolved = engine.query('trace.get', { ref }, OMNISCIENT_VIEWER);
      expect(resolved.ok && resolved.data !== null).toBe(true);
    }
    const arms = profile.condition.find((part) => part.part === 'arms');
    expect(arms?.injured).toBe(true);
    expect(arms?.nextCheck.value).toBe(arms?.value);
    expect(JSON.stringify(arms?.nextCheck.trace)).toContain(INJURED_PART_BRANCH);
    expect(profile.condition.filter((part) => part.injured)).toHaveLength(1);
    expect(profile.history).toEqual([]);
    expect(() => {
      assertSerialisable(profile, 'health.profile');
    }).not.toThrow();
  });
});

describe('health.profile injury rows', () => {
  it('lists closed injuries newest first, at most the last 50', () => {
    const count = HEALTH_PROFILE_HISTORY_LIMIT + 5;
    const { world, mine } = profileWorld((builder) => {
      let next = builder;
      for (let index = 0; index < count; index += 1) {
        const since = addDays(TEST_START_DATE, -400 + index * 5);
        next = next.withInjury(0, {
          since,
          expectedReturn: addDays(since, 3),
          returnedOn: addDays(since, 4),
        });
      }
      return next;
    });
    const engine = engineOver(world);
    const { history, current } = profileOf(engine, mine[0]);

    expect(current).toBeNull();
    expect(history).toHaveLength(HEALTH_PROFILE_HISTORY_LIMIT);
    const starts = history.map((injury) => injury.since);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(history[0]?.since).toBe(addDays(TEST_START_DATE, -400 + (count - 1) * 5));
    // Days out runs to the day they came back, not the expected return; no days left once back.
    expect(history[0]).toMatchObject({ daysOut: 4, daysRemaining: null, durationTraceRef: null });
  });

  it('falls back to the raw key when the catalog no longer has the kind', () => {
    const gone = parseContentKey('injury.dropped-by-a-mod');
    const { world, mine } = profileWorld((builder) => builder.withInjury(0, { kindKey: gone }));
    const engine = engineOver(world);
    expect(profileOf(engine, mine[0]).current).toMatchObject({ kindKey: gone, label: gone });
  });

  it('marks an unseen injury pending only for the worker’s own promotion', () => {
    const { world, mine, theirs } = profileWorld((builder) =>
      builder
        .withInjury(0, { noticedOn: null })
        .withInjury(0, {
          since: addDays(TEST_START_DATE, -30),
          expectedReturn: addDays(TEST_START_DATE, -20),
          returnedOn: addDays(TEST_START_DATE, -20),
          noticedOn: null,
        })
        .withInjury(2, { noticedOn: null }),
    );
    const engine = engineOver(world);

    const own = profileOf(engine, mine[0], OWNER);
    expect(own.current?.pendingNotice).toBe(true);
    expect(own.history[0]?.pendingNotice).toBe(true);
    for (const viewer of [RIVAL, OMNISCIENT_VIEWER]) {
      const seen = profileOf(engine, mine[0], viewer);
      expect(seen.current?.pendingNotice).toBe(false);
      expect(seen.history[0]?.pendingNotice).toBe(false);
    }
    // The rival's own worker is pending for the rival, not for the player.
    expect(profileOf(engine, theirs, RIVAL).current?.pendingNotice).toBe(true);
    expect(profileOf(engine, theirs, OWNER).current?.pendingNotice).toBe(false);
    // Apart from the flag, the player and the rival see the same.
    const forRival = profileOf(engine, mine[0], RIVAL);
    expect({ ...forRival, current: null, history: [] }).toEqual({
      ...own,
      current: null,
      history: [],
    });
  });
});
