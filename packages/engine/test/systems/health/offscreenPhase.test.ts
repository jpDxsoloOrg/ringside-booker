// The daily off-screen injury rolls. Design: docs/design/health.md#off-screen-injuries
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import { chance } from '../../../src/core/rng/odds';
import { RngRegistry } from '../../../src/core/rng/registry';
import { isFullTrace } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { GameWorld } from '../../../src/model/tables';
import {
  healthSystem,
  injuryRecordChanceTraceRef,
  isOffscreenEligible,
  OFFSCREEN_STREAM,
} from '../../../src/systems/health';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { aPerson } from '../../support/builders/people';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT = { kind: 'omniscient' } as const;
const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;

/** Settings that make a wrestler very likely to get hurt (about 1 in 3 a day, 1 for rivals). */
const HIGH_RISK: TunableOverrides = {
  'health.offscreen.injuriesPerYear': 5,
  'health.offscreen.injuryProneMultiplier': 3,
  'health.offscreen.fatigueWeight': 2,
  'health.offscreen.conditionWeight': 2,
  'health.offscreen.computerMultiplier': 10,
};

const TIRED_AND_PRONE = {
  traits: ['injuryProne'],
  fatigue: 100,
  condition: { head: 0, neck: 0, back: 0, arms: 0, torso: 0, legs: 0 },
} as const;

interface MixedWorld {
  world: GameWorld;
  /** Three rival wrestlers, then a free agent: the people who roll. */
  eligible: readonly PersonId[];
  freeAgent: PersonId;
  /** Retired, not yet debuted, already injured and a referee: they never roll. */
  skipped: readonly PersonId[];
}

function mixedWorld(risky = false): MixedWorld {
  const person = risky ? TIRED_AND_PRONE : {};
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withInjuryCatalog()
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) =>
      promotion.withRoster(3, { person: () => person }),
    )
    .with('a free agent and four people who never roll', (context) => {
      context.insert('people', aPerson({ ...person }, context.sequence));
      context.insert('people', aPerson({ ...person, status: 'retired' }, context.sequence));
      context.insert(
        'people',
        aPerson({ ...person, debutDate: addDays(TEST_START_DATE, 30) }, context.sequence),
      );
      context.insert('people', aPerson({ ...person }, context.sequence));
      context.insert(
        'people',
        aPerson({ ...person, roles: ['referee'], style: 'nonWrestler' }, context.sequence),
      );
    })
    .withInjury(6, { since: addDays(TEST_START_DATE, -3), expectedReturn: addDays(TEST_START_DATE, 60) })
    .build();
  const people = ids.people;
  const freeAgent = people[3];
  if (people.length !== 8 || freeAgent === undefined) {
    throw new Error('the mixed world should have eight people');
  }
  return { world, eligible: people.slice(0, 4), freeAgent, skipped: people.slice(4) };
}

async function engineOver(world: GameWorld, overrides: TunableOverrides = {}): Promise<Engine> {
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, healthSystem],
  });
  for (const [key, value] of Object.entries(overrides)) {
    const result = engine.command('tunables.setOverride', { key, value }, HUMAN);
    if (!result.ok) {
      throw new Error(`could not set ${key}: ${JSON.stringify(result.reasons)}`);
    }
  }
  return Promise.resolve(engine);
}

function offscreenStreamOf(engine: Engine): unknown {
  return engine.exportState().rng.streams[OFFSCREEN_STREAM];
}

function injuredIds(engine: Engine): PersonId[] {
  return engine
    .exportState()
    .world.tables.injuries.filter(
      // The world starts with one injury of its own, from before the run.
      (row) => row.source === 'world' && row.returnedOn === null && row.since >= TEST_START_DATE,
    )
    .map((row) => row.personId);
}

describe('isOffscreenEligible', () => {
  it('lets active, debuted, uninjured wrestlers roll and nobody else', () => {
    const { world, eligible, skipped } = mixedWorld();
    const people = new Map(world.tables.people.values().map((person) => [person.id, person]));
    for (const id of eligible) {
      expect(isOffscreenEligible(people.get(id)!, TEST_START_DATE), id).toBe(true);
    }
    for (const id of skipped) {
      expect(isOffscreenEligible(people.get(id)!, TEST_START_DATE), id).toBe(false);
    }
  });

  it('counts an occasional wrestler, and a debut on the day itself', () => {
    const occasional = aPerson({ roles: ['occasionalWrestler'], debutDate: TEST_START_DATE });
    expect(isOffscreenEligible(occasional, TEST_START_DATE)).toBe(true);
  });
});

describe('health.offscreenInjuries', () => {
  it('draws exactly once for each eligible wrestler, even with the rate at 0', async () => {
    const { world, eligible } = mixedWorld();
    const engine = await engineOver(world, { 'health.offscreen.injuriesPerYear': 0 });
    await engine.advanceDays({ maxDays: 1 });
    const expected = new RngRegistry(world.meta.seed);
    const stream = expected.stream(OFFSCREEN_STREAM);
    for (let draw = 0; draw < eligible.length; draw++) {
      chance(stream, 0.5);
    }
    expect(offscreenStreamOf(engine)).toEqual(expected.toState().streams[OFFSCREEN_STREAM]);
    expect(injuredIds(engine)).toEqual([]);
  });

  it('keeps the stream aligned when a tunable changes', async () => {
    const plain = await engineOver(mixedWorld().world);
    const tuned = await engineOver(mixedWorld().world, HIGH_RISK);
    await plain.advanceDays({ maxDays: 1 });
    await tuned.advanceDays({ maxDays: 1 });
    expect(offscreenStreamOf(tuned)).toEqual(offscreenStreamOf(plain));
  });

  it('hurts every rival wrestler when the chance reaches 1, and never the people who do not roll', async () => {
    const { world, eligible, skipped } = mixedWorld(true);
    const engine = await engineOver(world, HIGH_RISK);
    const result = await engine.advanceDays({ maxDays: 1 });
    expect(result.failures).toEqual([]);
    const hurt = injuredIds(engine);
    for (const id of eligible.slice(0, 3)) {
      expect(hurt).toContain(id);
    }
    for (const id of skipped) {
      expect(hurt).not.toContain(id);
    }
  });

  it('can hurt a free agent, and keeps the chance behind it as a summary', async () => {
    const { world, freeAgent } = mixedWorld(true);
    const engine = await engineOver(world, HIGH_RISK);
    await engine.advanceDays({ maxDays: 30 });
    const row = engine
      .exportState()
      .world.tables.injuries.find((entry) => entry.personId === freeAgent && entry.source === 'world');
    if (row === undefined) {
      throw new Error('expected the free agent to be hurt within 30 days');
    }
    // Nobody the player employs: noticed on the day, and only a summary of the Why? is kept.
    expect(row.noticedOn).toBe(row.since);
    const stored = engine.query('trace.get', { ref: injuryRecordChanceTraceRef(row.id) }, OMNISCIENT);
    if (!stored.ok || stored.data === null) {
      throw new Error('expected the chance to be stored');
    }
    expect(isFullTrace(stored.data)).toBe(false);
    expect(stored.data).toMatchObject({ label: 'Off-screen injury chance today', summaryOnly: true });
  });

  it('hurts nobody with the rate at 0', async () => {
    const engine = await engineOver(mixedWorld(true).world, {
      ...HIGH_RISK,
      'health.offscreen.injuriesPerYear': 0,
    });
    await engine.advanceDays({ maxDays: 30 });
    expect(injuredIds(engine)).toEqual([]);
  });

  it('rolls nothing in a world with no injury catalog', async () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(3))
      .build();
    const engine = await engineOver(world, HIGH_RISK);
    const result = await engine.advanceDays({ maxDays: 1 });
    expect(result.failures).toEqual([]);
    expect(offscreenStreamOf(engine)).toBeUndefined();
    expect(engine.exportState().world.tables.injuries).toEqual([]);
  });

  it('gives the same injuries for the same seed', async () => {
    const first = await engineOver(mixedWorld(true).world, HIGH_RISK);
    const second = await engineOver(mixedWorld(true).world, HIGH_RISK);
    await first.advanceDays({ maxDays: 10 });
    await second.advanceDays({ maxDays: 10 });
    expect(second.exportState()).toEqual(first.exportState());
  });
});
