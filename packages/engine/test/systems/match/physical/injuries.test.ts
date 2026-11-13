// The in-match injury roll and the handler seam (MTCH4-02).
// Design: docs/design/physical-toll.md#the-injury-roll
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryError } from '../../../../src/core/errors';
import type { PersonId } from '../../../../src/core/ids';
import { chance as drawChance } from '../../../../src/core/rng/odds';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { constantOf, findTraceNodes, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { BodyCondition } from '../../../../src/model/entities/person';
import {
  INJURY_STREAM,
  clearInjuryHandler,
  collectPhysicalInputs,
  collectRiskContributions,
  computeInjuryChance,
  getInjuryHandler,
  injuryChanceTraceRef,
  injuryPolicyFor,
  injuryRollTraceRef,
  fatigueTraceRef,
  learningTraceRef,
  registerInjuryHandler,
  registerRiskModifier,
  restoreBuiltInInjuryHandler,
  rollSegmentInjuries,
  wearTraceRef,
  type InjuryRollEntry,
  type RiskContext,
} from '../../../../src/systems/match';
import {
  clearRatingPolicyProvider,
  registerRatingPolicyProvider,
  restoreBuiltInRatingPolicyProvider,
  NEUTRAL_RATING_POLICY,
} from '../../../../src/systems/match/rating/policy';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { testId } from '../../../support/ids';
import { expectRollRecorded, expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

const FULL: BodyCondition = { head: 100, neck: 100, back: 100, arms: 100, torso: 100, legs: 100 };

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function stream(seed = 'injury'): RngStream {
  return new RngRegistry(seed).stream(INJURY_STREAM);
}

function entry(
  serial: number,
  probability: number,
  place: { side?: number; entranceOrder?: number | null; condition?: BodyCondition } = {},
): InjuryRollEntry {
  const name = `Worker ${String(serial)}`;
  return {
    personId: testId('person', serial),
    name,
    chance: constantOf(`Injury chance for ${name}`, probability, 'Test chance'),
    side: place.side ?? 0,
    entranceOrder: place.entranceOrder ?? null,
    conditionAfterWear: place.condition ?? FULL,
  };
}

function roll(
  entries: readonly InjuryRollEntry[],
  tunables: TunableOverrides = {},
  rng: RngStream = stream(),
) {
  return rollSegmentInjuries(entries, { tunables: createEngineTunables(tunables), rng });
}

describe('rollSegmentInjuries', () => {
  it('rolls in a fixed order: side, then entrance order (unset last), then person id', () => {
    const results = roll([
      entry(5, 0, { side: 1 }),
      entry(4, 0, { side: 0 }),
      entry(3, 0, { side: 0, entranceOrder: 2 }),
      entry(2, 0, { side: 0, entranceOrder: 1 }),
      entry(1, 0, { side: 1, entranceOrder: 1 }),
    ]);
    expect(results.map((result) => result.name)).toEqual([
      'Worker 2',
      'Worker 3',
      'Worker 4',
      'Worker 1',
      'Worker 5',
    ]);
  });

  it('records each worker’s roll from match.injury with the chance as its odds', () => {
    const [result] = roll([entry(1, 0.25)]);
    if (result === undefined) throw new Error('no result');
    const record = expectRollRecorded(result.decision, 'match.injury');
    expect(record.label).toBe('Injury roll: Worker 1');
    expect(record.odds).toBe(0.25);
    expect(result.decision.trace.label).toBe('Injured in this match?');
    expectSerialisable(result.decision);
  });

  it('draws exactly once per worker with chance 0, maxPerSegment 0 or a hit already taken', () => {
    const cases: [InjuryRollEntry[], TunableOverrides][] = [
      [[entry(1, 0), entry(2, 0), entry(3, 0)], {}],
      [[entry(1, 1), entry(2, 1), entry(3, 1)], { 'match.injury.maxPerSegment': 0 }],
      [[entry(1, 1), entry(2, 0.5), entry(3, 1)], {}],
    ];
    const after = cases.map(([entries, tunables]) => {
      const rng = stream();
      const results = roll(entries, tunables, rng);
      for (const result of results) {
        expectRollRecorded(result.decision, 'match.injury');
        expect(findTraceNodes(result.decision.trace, 'roll')).toHaveLength(1);
      }
      return rng.nextUint32();
    });
    const fresh = stream();
    for (let draw = 0; draw < 3; draw += 1) {
      drawChance(fresh, 0.5);
    }
    // Every case leaves the stream where three plain draws leave it.
    const expected = fresh.nextUint32();
    expect(after).toEqual([expected, expected, expected]);
  });

  it('injures nobody with maxPerSegment 0, recording the ignored hits', () => {
    const results = roll([entry(1, 1), entry(2, 1)], { 'match.injury.maxPerSegment': 0 });
    expect(results.map((result) => [result.hit, result.injured])).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(JSON.stringify(results[0]?.decision.trace)).toContain(
      'Already 0 injured in this segment (most per segment: 0)',
    );
  });

  it('with maxPerSegment 1 injures only the first forced hit in roll order', () => {
    const results = roll([entry(2, 1, { side: 1 }), entry(1, 1, { side: 0 })]);
    const [first, second] = results;
    if (first === undefined || second === undefined) throw new Error('two results');
    expect(first.name).toBe('Worker 1');
    expect(first.injured).toBe(true);
    expect(first.decision.value).toBe('injured');
    expect(second.hit).toBe(true);
    expect(second.injured).toBe(false);
    expect(second.decision.value).toBe('unhurt');
    const rules = findTraceNodes(second.decision.trace, 'branch').map((node) => node.label);
    expect(rules).toEqual(['Already 1 injured in this segment (most per segment: 1)']);
    expect(findTraceNodes(first.decision.trace, 'branch')).toEqual([]);
  });

  it('with maxPerSegment 2 injures both', () => {
    const results = roll([entry(1, 1), entry(2, 1)], { 'match.injury.maxPerSegment': 2 });
    expect(results.map((result) => result.injured)).toEqual([true, true]);
  });

  it('hints the lowest body part after wear for an injured worker only', () => {
    const results = roll([
      entry(1, 1, { condition: { ...FULL, arms: 60, legs: 60 } }),
      entry(2, 0, { condition: { ...FULL, back: 10 } }),
    ]);
    expect(results.map((result) => result.bodyPartHint)).toEqual(['arms', null]);
  });

  it('never injures anyone at chance 0', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const results = roll([entry(1, 0), entry(2, 0)], {}, stream(seed));
      expect(results.every((result) => !result.hit && !result.injured)).toBe(true);
    }
  });
});

describe('the roll comes last', () => {
  it('rolls with a chance that already includes a risk contribution for one worker only', () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(2))
      .build();
    const [first, second] = ids.people;
    if (first === undefined || second === undefined) throw new Error('no people');
    const spec: RiskContext = {
      read: world,
      promotionId: ids.promotions.A!,
      importance: 'regular',
      kind: 'match',
      durationClass: 'standard',
      sides: [
        [{ personId: first, role: 'competitor' }],
        [{ personId: second, role: 'competitor' }],
      ],
      crew: { producerId: null },
      keepItSafe: false,
    };
    const source = 'Major spot: Dive through a table';
    cleanups.push(
      registerRiskModifier({
        id: 'test.majorSpot',
        order: 10,
        contribute: () => [{ source, personIds: [first], injuryMultiplier: 3 }],
      }),
    );
    const tunables = createEngineTunables();
    const chances = new Map<PersonId, Traced<number>>();
    const entries = collectPhysicalInputs(world, spec).map((worker): InjuryRollEntry => {
      const chance = computeInjuryChance(
        {
          name: worker.name,
          durationClass: spec.durationClass,
          fatigueGoingIn: worker.fatigue,
          fatigueGain: 0,
          conditionAfterWear: worker.condition,
          style: worker.style,
          traits: worker.traits,
          opponents: worker.opponents,
          contributions: collectRiskContributions(spec, worker.personId),
          keepItSafe: spec.keepItSafe,
          matchesEarlierTonight: worker.matchesEarlierTonight,
          skipInMatchInjuries: false,
        },
        { tunables },
      );
      chances.set(worker.personId, chance);
      return {
        personId: worker.personId,
        name: worker.name,
        chance,
        side: worker.side,
        entranceOrder: null,
        conditionAfterWear: worker.condition,
      };
    });
    const lines = (personId: PersonId) =>
      (chances.get(personId)?.trace.children ?? []).map((node) => node.label);
    expect(lines(first)).toContain(source);
    expect(lines(second)).not.toContain(source);

    const results = rollSegmentInjuries(entries, { tunables, rng: stream() });
    const firstResult = results.find((result) => result.personId === first);
    const firstChance = chances.get(first)?.value ?? 0;
    expect(expectRollRecorded(firstResult!.decision, 'match.injury').odds).toBe(firstChance);
    // The multiplier is inside the rolled chance: three times what it would be without it.
    const spotStep = (chances.get(first)?.trace.children ?? []).find(
      (node) => node.label === source && node.kind === 'multiply',
    );
    expect(spotStep?.kind).toBe('multiply');
    if (spotStep?.kind === 'multiply') {
      expect(spotStep.after).toBeCloseTo(spotStep.before * 3, 12);
    }
  });
});

describe('injuryPolicyFor', () => {
  afterEach(() => {
    restoreBuiltInRatingPolicyProvider();
  });

  it('says no for the neutral policy and passes a skipping policy on with its trace', () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(1))
      .build();
    const tunables = createEngineTunables();
    const promotionId = ids.promotions.A!;
    clearRatingPolicyProvider();
    expect(injuryPolicyFor(world, tunables, promotionId).skipInMatchInjuries).toBe(false);

    registerRatingPolicyProvider(
      () => ({
        ...NEUTRAL_RATING_POLICY,
        skipInMatchInjuries: true,
        label: 'Rival shortcuts',
        lines: ['Rival shortcut: No in-match injuries'],
      }),
      { id: 'test.policy' },
    );
    const policy = injuryPolicyFor(world, tunables, promotionId);
    expect(policy.skipInMatchInjuries).toBe(true);
    expect(policy.trace.label).toBe('Rival shortcuts');
    expect(JSON.stringify(policy.trace)).toContain('Rival shortcut: No in-match injuries');
    expectSerialisable(policy.trace);
  });
});

describe('registerInjuryHandler', () => {
  // WRK6-03's health.injure registers itself on import as the built-in handler; these tests need
  // the seam empty and put the built-in back afterwards.
  beforeEach(() => {
    clearInjuryHandler();
  });
  afterEach(() => {
    restoreBuiltInInjuryHandler();
  });

  it('holds exactly one handler and refuses a second, naming both', () => {
    expect(getInjuryHandler()).toBeNull();
    const unregister = registerInjuryHandler({
      id: 'health.injure',
      apply: () => ({ injuryTraceRef: null }),
    });
    cleanups.push(unregister);
    expect(getInjuryHandler()?.id).toBe('health.injure');
    expect(() =>
      registerInjuryHandler({ id: 'test.other', apply: () => ({ injuryTraceRef: null }) }),
    ).toThrow(RegistryError);
    expect(() =>
      registerInjuryHandler({ id: 'test.other', apply: () => ({ injuryTraceRef: null }) }),
    ).toThrow(/test\.other.*health\.injure/);
    unregister();
    expect(getInjuryHandler()).toBeNull();
  });

  it('refuses a malformed id', () => {
    expect(() =>
      registerInjuryHandler({ id: 'Not An Id', apply: () => ({ injuryTraceRef: null }) }),
    ).toThrow(RegistryError);
    expect(getInjuryHandler()).toBeNull();
  });

  it('puts back the built-in handler after a clear', async () => {
    const { HEALTH_INJURY_HANDLER_ID } = await import('../../../../src/systems/health');
    restoreBuiltInInjuryHandler();
    expect(getInjuryHandler()?.id).toBe(HEALTH_INJURY_HANDLER_ID);
    clearInjuryHandler();
    expect(getInjuryHandler()).toBeNull();
  });
});

describe('physical trace refs', () => {
  it('keys every ref <segmentId>:<personId> under its kind', () => {
    const segmentId = testId('segment', 1);
    const personId = testId('person', 2);
    const id = `${segmentId}:${personId}`;
    expect(injuryChanceTraceRef(segmentId, personId)).toEqual({ kind: 'match.injuryChance', id });
    expect(injuryRollTraceRef(segmentId, personId)).toEqual({ kind: 'match.injuryRoll', id });
    expect(fatigueTraceRef(segmentId, personId)).toEqual({ kind: 'match.fatigue', id });
    expect(wearTraceRef(segmentId, personId)).toEqual({ kind: 'match.wear', id });
    expect(learningTraceRef(segmentId, personId)).toEqual({ kind: 'match.learning', id });
  });
});
