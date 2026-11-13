// Condition wear (MTCH4-01). Design: docs/design/physical-toll.md#wear
import { describe, expect, it } from 'vitest';
import { floatBetween } from '../../../../src/core/rng/odds';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { RingStyle } from '../../../../src/model/entities/person';
import {
  WEAR_STREAM,
  computeConditionWear,
  type ConditionWearInputs,
  type PhysicalOpponent,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectRollRecorded, expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { testId } from '../../../support/ids';

function stream(seed = 'wear'): RngStream {
  return new RngRegistry(seed).stream(WEAR_STREAM);
}

function opponent(serial: number, style: RingStyle = 'allRounder', safety = 50): PhysicalOpponent {
  return { personId: testId('person', serial), name: `Worker ${String(serial)}`, safety, style };
}

function inputs(overrides: Partial<ConditionWearInputs> = {}): ConditionWearInputs {
  return {
    name: 'Kai Moreno',
    durationClass: 'long',
    style: 'allRounder',
    traits: [],
    opponents: [opponent(2)],
    importance: 'regular',
    contributions: [],
    keepItSafe: false,
    matchesEarlierTonight: 0,
    ...overrides,
  };
}

/** Wear with no randomness: the roll is still drawn, but spread 0 makes it a factor of 1. */
function steady(overrides: Partial<ConditionWearInputs> = {}, tunables: TunableOverrides = {}) {
  return computeConditionWear(inputs(overrides), {
    tunables: createEngineTunables({ 'match.wear.spread': 0, ...tunables }),
    rng: stream(),
  });
}

function labels(result: ReturnType<typeof steady>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('computeConditionWear', () => {
  it.each([0, 0.5])('draws exactly once from match.wear with spread %s', (spread) => {
    const counted = stream();
    const fresh = stream();
    const result = computeConditionWear(inputs(), {
      tunables: createEngineTunables({ 'match.wear.spread': spread }),
      rng: counted,
    });
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(1);
    expectRollRecorded(result, 'match.wear');
    // The same stream after one float draw is where the formula left it.
    floatBetween(fresh, 0, 1);
    expect(counted.nextUint32()).toBe(fresh.nextUint32());
  });

  it('names the duration class first; long wears more than short', () => {
    expect(labels(steady())[0]).toBe('Long duration class');
    expect(steady().value).toBeCloseTo(0.6);
    expect(steady({ durationClass: 'short' }).value).toBeCloseTo(0.2);
  });

  it("applies the worker's own style", () => {
    expect(steady({ style: 'highFlyer' }).value).toBeCloseTo(0.9);
  });

  it('picks the roughest opponent by style factor, ties by person id', () => {
    const result = steady({
      opponents: [opponent(3, 'grappler'), opponent(2, 'striker')],
    });
    expect(labels(result)).toContain('Roughest opponent: Worker 2 (Striker)');
    expect(result.value).toBeCloseTo(0.6 * 1.3);
    // Hardcore and striker are both 1.3: the lower person id wins the tie, in either order.
    const hardcore = opponent(9, 'hardcore');
    const striker = opponent(4, 'striker');
    const lower = hardcore.personId < striker.personId ? hardcore : striker;
    const lowerLabel = lower === hardcore ? 'Hardcore' : 'Striker';
    for (const opponents of [
      [hardcore, striker],
      [striker, hardcore],
    ]) {
      expect(labels(steady({ opponents }))).toContain(
        `Roughest opponent: ${lower.name} (${lowerLabel})`,
      );
    }
  });

  it("scales by the opponents' safety and clamps the factor at both ends", () => {
    const careless = steady({ opponents: [opponent(2, 'allRounder', 25)] });
    expect(careless.value).toBeCloseTo(0.6 * 1.2);
    expect(labels(careless)).toContain("Opponents' safety 25");
    const heavy = { 'match.wear.safetyWeight': 0.05 };
    expect(steady({ opponents: [opponent(2, 'allRounder', 0)] }, heavy).value).toBeCloseTo(
      0.6 * 1.4,
    );
    expect(steady({ opponents: [opponent(2, 'allRounder', 100)] }, heavy).value).toBeCloseTo(
      0.6 * 0.6,
    );
  });

  it('notes a match with no opponents', () => {
    expect(labels(steady({ opponents: [] }))).toContain('No opponents');
  });

  it('wears a durable worker less than an injury-prone one', () => {
    expect(steady({ traits: ['durable'] }).value).toBeCloseTo(0.6 * 0.7);
    expect(steady({ traits: ['injuryProne'] }).value).toBeCloseTo(0.6 * 1.3);
  });

  it('applies a house show, a contribution, repeat matches and keep it safe', () => {
    expect(steady({ importance: 'house' }).value).toBeCloseTo(0.36);
    const ladder = steady({
      contributions: [{ source: 'Stipulation: Ladder', personIds: null, wearMultiplier: 2 }],
    });
    expect(ladder.value).toBeCloseTo(1.2);
    expect(labels(ladder)).toContain('Stipulation: Ladder');
    const second = steady({ matchesEarlierTonight: 1 });
    expect(second.value).toBeCloseTo(0.9);
    expect(labels(second)).toContain('Second match tonight ×1.5');
    expect(steady({ keepItSafe: true }).value).toBeCloseTo(0.3);
  });

  it('moves wear by up to the spread either way', () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (seed) =>
        computeConditionWear(inputs(), { tunables: createEngineTunables(), rng: stream(seed) })
          .value,
    );
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0.3);
      expect(value).toBeLessThanOrEqual(0.9);
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('clamps at maxPerSegment', () => {
    const result = steady({
      contributions: [{ source: 'Stipulation: Hardcore', personIds: null, wearMultiplier: 50 }],
    });
    expect(result.value).toBe(5);
  });

  it('replays and serialises', () => {
    const result = computeConditionWear(
      inputs({
        style: 'hardcore',
        traits: ['injuryProne'],
        importance: 'house',
        keepItSafe: true,
        matchesEarlierTonight: 2,
        opponents: [opponent(2, 'brawler', 30), opponent(3, 'technician', 70)],
        contributions: [{ source: 'Stipulation: Cage', personIds: null, wearMultiplier: 1.4 }],
      }),
      { tunables: createEngineTunables(), rng: stream() },
    );
    expectTraceReplays(result);
    expectSerialisable(result);
  });
});
