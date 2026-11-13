// The physical toll in one fixed order (MTCH4-04): inputs, risk contributions, fatigue, wear in roll
// order, learning, injury chance from the state after the match, and the injury roll last.
// Design: docs/design/physical-toll.md#the-order
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes } from '../../../../src/core/trace';
import type { Person } from '../../../../src/model/entities/person';
import {
  ALREADY_INJURED_TONIGHT_LABEL,
  INJURY_STREAM,
  WEAR_STREAM,
  computePhysicalToll,
  registerRiskModifier,
  type PhysicalParticipant,
  type PhysicalSegmentSpec,
  type PhysicalTollDeps,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { BODY_PART_LABELS, formatNumber } from '../../../../src/systems/world/people/labels';
import type { DeepPartial } from '../../../support/builders/build-row';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

const OPEN = { potential: 900, ceilings: {} };
const TUNABLES = createEngineTunables();
const NO_POLICY = { skipInMatchInjuries: false, trace: null } as const;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function built(people: readonly DeepPartial<Person>[] = []) {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(4, {
        person: (index) => ({ development: OPEN, ...(people[index] ?? {}) }),
      }),
    )
    .build();
  const person = (index: number): PersonId => {
    const id = ids.people[index];
    if (id === undefined) throw new Error(`no person ${String(index)}`);
    return id;
  };
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) throw new Error('no promotion');
  const spec = (
    sides: { index: number; entranceOrder?: number }[][],
    extra: Partial<PhysicalSegmentSpec> = {},
  ): PhysicalSegmentSpec => ({
    promotionId,
    importance: 'regular',
    kind: 'match',
    durationClass: 'standard',
    sides: sides.map((side) =>
      side.map(
        ({ index, entranceOrder }): PhysicalParticipant => ({
          personId: person(index),
          role: 'competitor',
          entranceOrder: entranceOrder ?? null,
        }),
      ),
    ),
    crew: { producerId: null },
    keepItSafe: false,
    ...extra,
  });
  return { world, person, spec };
}

/** A stream that writes each draw's stream name to `log`. */
function logged(name: string, log: string[]): RngStream {
  const stream = new RngRegistry('toll').stream(name === 'wear' ? WEAR_STREAM : INJURY_STREAM);
  return {
    name: stream.name,
    nextUint32: () => {
      log.push(name);
      return stream.nextUint32();
    },
    nextFloat: () => {
      log.push(name);
      return stream.nextFloat();
    },
  };
}

function deps(extra: Partial<PhysicalTollDeps> = {}): PhysicalTollDeps {
  return {
    tunables: TUNABLES,
    policy: NO_POLICY,
    wearRng: new RngRegistry('toll').stream(WEAR_STREAM),
    injuryRng: new RngRegistry('toll').stream(INJURY_STREAM),
    ...extra,
  };
}

describe('computePhysicalToll', () => {
  it('runs risk, wear and the injury roll in that order, the roll last', () => {
    const { world, spec } = built();
    const log: string[] = [];
    cleanups.push(
      registerRiskModifier({
        id: 'test.orderProbe',
        order: 0,
        contribute: () => {
          log.push('risk');
          return [];
        },
      }),
    );
    const toll = computePhysicalToll(
      world,
      spec([[{ index: 0 }], [{ index: 1 }]]),
      deps({ wearRng: logged('wear', log), injuryRng: logged('injury', log) }),
    );
    expect(toll.workers).toHaveLength(2);
    // Risk per worker first, then one wear draw each, then one injury draw each.
    const firstWear = log.indexOf('wear');
    const firstInjury = log.indexOf('injury');
    expect(log.slice(0, firstWear).every((entry) => entry === 'risk')).toBe(true);
    expect(log.filter((entry) => entry === 'wear')).toHaveLength(2);
    expect(log.filter((entry) => entry === 'injury')).toHaveLength(2);
    expect(log.lastIndexOf('wear')).toBeLessThan(firstInjury);
    expect(log.slice(firstInjury).every((entry) => entry === 'injury')).toBe(true);
  });

  it('draws wear in roll order: side, then entrance order', () => {
    const { world, spec, person } = built();
    const tag = spec([
      [
        { index: 0, entranceOrder: 2 },
        { index: 1, entranceOrder: 1 },
      ],
      [{ index: 2 }, { index: 3 }],
    ]);
    const toll = computePhysicalToll(world, tag, deps());
    expect(toll.workers.map((worker) => worker.personId)).toEqual([
      person(1),
      person(0),
      ...[person(2), person(3)].sort(),
    ]);
    // The first wear draw went to the worker who entered first.
    const alone = computePhysicalToll(
      world,
      spec([[{ index: 1 }], [{ index: 2 }]]),
      deps({ wearRng: new RngRegistry('toll').stream(WEAR_STREAM) }),
    );
    const firstRoll = (worker: (typeof toll.workers)[number]) =>
      findTraceNodes(worker.wearLoad.trace, 'roll')[0]?.roll;
    expect(firstRoll(toll.workers[0] ?? never())).toEqual(
      firstRoll(alone.workers[0] ?? never()),
    );
  });

  it('works the injury chance out from fatigue and condition after this match', () => {
    const { world, spec } = built([{ fatigue: 30 }]);
    const toll = computePhysicalToll(world, spec([[{ index: 0 }], [{ index: 1 }]]), deps());
    const worker = toll.workers.find((entry) => entry.fatigueBefore === 30) ?? never();
    expect(worker.fatigueAfter).toBeCloseTo(30 + worker.fatigueGain.value, 10);
    const labels = (worker.injuryChance.trace.children ?? []).map((node) => node.label);
    expect(labels).toContain(
      `Worst body part: ${BODY_PART_LABELS[worker.worstPartAfter.part]} ${formatNumber(worker.worstPartAfter.value)}`,
    );
    // The end-of-match fatigue line carries this match's gain.
    const end = findTraceNodes(worker.injuryChance.trace, 'add').find(
      (node) => node.label === 'Fatigue from this match',
    );
    expect(end?.operand).toBe(worker.fatigueGain.value);
    expect(worker.conditionAfter.head).toBeCloseTo(100 - worker.wearByPart.head.value, 10);
  });

  it('is plain JSON', () => {
    const { world, spec } = built();
    expectSerialisable(
      computePhysicalToll(world, spec([[{ index: 0 }, { index: 1 }], [{ index: 2 }]]), deps()),
    );
  });

  it('gives no workers and draws nothing for an angle', () => {
    const { world, spec } = built();
    const log: string[] = [];
    const toll = computePhysicalToll(
      world,
      spec([[{ index: 0 }], [{ index: 1 }]], { kind: 'angle' }),
      deps({ wearRng: logged('wear', log), injuryRng: logged('injury', log) }),
    );
    expect(toll.workers).toEqual([]);
    expect(log).toEqual([]);
  });

  it('never rolls a worker already injured tonight, but still draws for them', () => {
    const { world, spec, person } = built();
    const forced = createEngineTunables({
      'match.injury.baseChance': 0.2,
      'match.injury.maxChance': 1,
      'match.injury.maxPerSegment': 2,
    });
    cleanups.push(
      registerRiskModifier({
        id: 'test.certainInjury',
        order: 0,
        contribute: () => [{ source: 'Test: certain injury', personIds: null, injuryAdd: 1 }],
      }),
    );
    const log: string[] = [];
    const toll = computePhysicalToll(
      world,
      spec([[{ index: 0 }], [{ index: 1 }]]),
      deps({
        tunables: forced,
        injuryRng: logged('injury', log),
        alreadyInjured: new Map([[person(0), 'tonight' as const]]),
      }),
    );
    const hurt = toll.workers.find((worker) => worker.personId === person(0)) ?? never();
    const other = toll.workers.find((worker) => worker.personId === person(1)) ?? never();
    expect(hurt.injuryChance.value).toBe(0);
    expect(findTraceNodes(hurt.injuryChance.trace, 'branch').map((node) => node.label)).toContain(
      ALREADY_INJURED_TONIGHT_LABEL,
    );
    expect(hurt.injury.injured).toBe(false);
    expect(other.injury.injured).toBe(true);
    expect(other.injury.bodyPartHint).toBe(other.worstPartAfter.part);
    expect(log.filter((entry) => entry === 'injury')).toHaveLength(2);
  });

  it('marks a hit past the per-segment limit as ignored', () => {
    const { world, spec } = built();
    const forced = createEngineTunables({ 'match.injury.maxChance': 1 });
    cleanups.push(
      registerRiskModifier({
        id: 'test.certainInjury',
        order: 0,
        contribute: () => [{ source: 'Test: certain injury', personIds: null, injuryAdd: 1 }],
      }),
    );
    const toll = computePhysicalToll(
      world,
      spec([[{ index: 0 }], [{ index: 1 }]]),
      deps({ tunables: forced }),
    );
    expect(toll.workers.map((worker) => worker.injury.injured)).toEqual([true, false]);
    expect(toll.workers.map((worker) => worker.injury.ignoredOverLimit)).toEqual([false, true]);
  });
});

function never(): never {
  throw new Error('missing');
}
